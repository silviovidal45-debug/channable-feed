export default async function handler(req, res) {
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  const accessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;
  const storefrontDomain = process.env.STOREFRONT_DOMAIN;

  if (!storeHash || !accessToken || !storefrontDomain) {
    return res.status(500).send("Missing environment variables");
  }

  try {
    let page = 1;
    let allProducts = [];

    while (true) {
      const response = await fetch(
        `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products?limit=250&page=${page}&include=custom_fields,images`,
        {
          headers: {
            "X-Auth-Token": accessToken,
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return res
          .status(response.status)
          .send(`BigCommerce API error: ${errorText}`);
      }

      const json = await response.json();
      const products = json.data || [];

      allProducts = allProducts.concat(products);

      if (products.length < 250) break;
      page++;
    }

    const escapeCsv = (value) => {
      const str = value == null ? "" : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const stripHtml = (html) => {
      if (!html) return "";
      return String(html)
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    };

    const normalizeCustomFields = (customFields) => {
      const map = {};
      if (!Array.isArray(customFields)) return map;

      for (const field of customFields) {
        const key = String(field.name || "").trim().toLowerCase();
        const value = String(field.value || "").trim();
        map[key] = value;
      }

      return map;
    };

    const buildProductUrl = (product) => {
      const path = product.custom_url?.url || "";
      if (!path) return "";
      return `https://${storefrontDomain}${path}`;
    };

    const buildImageUrl = (product) => {
      if (Array.isArray(product.images) && product.images.length > 0) {
        return (
          product.images[0].url_standard ||
          product.images[0].url_zoom ||
          product.images[0].url_thumbnail ||
          ""
        );
      }
      return "";
    };

    const normalizeAvailability = (product) => {
      if (Number(product.inventory_level || 0) > 0) return "in stock";
      return "out of stock";
    };

    const filtered = allProducts.filter((product) => {
      const customFieldMap = normalizeCustomFields(product.custom_fields);
      return String(customFieldMap.channable || "").toLowerCase() === "yes";
    });

    let csv = [
      [
        "id",
        "title",
        "description",
        "link",
        "image_link",
        "availability",
        "price",
        "sale_price",
        "brand",
        "condition",
        "gtin",
        "mpn",
        "item_group_id",
        "google_product_category",
        "product_type",
      ].join(","),
    ];

    filtered.forEach((product) => {
      const customFieldMap = normalizeCustomFields(product.custom_fields);

      const brand = product.brand_name || customFieldMap.brand || "";
      const gtin = customFieldMap.gtin || product.upc || "";
      const mpn = customFieldMap.mpn || product.sku || "";
      const googleProductCategory =
        customFieldMap.google_product_category || "";
      const productType = customFieldMap.product_type || "";
      const price =
        product.price != null ? `${Number(product.price).toFixed(2)} EUR` : "";
      const salePrice =
        product.sale_price != null && Number(product.sale_price) > 0
          ? `${Number(product.sale_price).toFixed(2)} EUR`
          : "";

      const row = [
        escapeCsv(product.id),
        escapeCsv(product.name || ""),
        escapeCsv(stripHtml(product.description || "")),
        escapeCsv(buildProductUrl(product)),
        escapeCsv(buildImageUrl(product)),
        escapeCsv(normalizeAvailability(product)),
        escapeCsv(price),
        escapeCsv(salePrice),
        escapeCsv(brand),
        escapeCsv("new"),
        escapeCsv(gtin),
        escapeCsv(mpn),
        escapeCsv(product.sku || ""),
        escapeCsv(googleProductCategory),
        escapeCsv(productType),
      ];

      csv.push(row.join(","));
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    res.status(200).send(csv.join("\n"));
  } catch (error) {
    res.status(500).send(`Server error: ${error.message}`);
  }
}
