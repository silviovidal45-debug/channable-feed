export default async function handler(req, res) {
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  const accessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;
  const storefrontDomain = process.env.STOREFRONT_DOMAIN;

  if (!storeHash || !accessToken || !storefrontDomain) {
    return res.status(500).send("Missing environment variables");
  }

  try {
    const headers = {
      "X-Auth-Token": accessToken,
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    const fetchAllProducts = async () => {
      let page = 1;
      let allProducts = [];

      while (true) {
        const response = await fetch(
          `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products?limit=250&page=${page}&include=custom_fields,images`,
          { headers }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Products API error: ${errorText}`);
        }

        const json = await response.json();
        const products = json.data || [];

        allProducts = allProducts.concat(products);

        if (products.length < 250) break;
        page++;
      }

      return allProducts;
    };

    const fetchAllBrands = async () => {
      let page = 1;
      let allBrands = [];

      while (true) {
        const response = await fetch(
          `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/brands?limit=250&page=${page}`,
          { headers }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Brands API error: ${errorText}`);
        }

        const json = await response.json();
        const brands = json.data || [];

        allBrands = allBrands.concat(brands);

        if (brands.length < 250) break;
        page++;
      }

      return allBrands;
    };

    const [allProducts, allBrands] = await Promise.all([
      fetchAllProducts(),
      fetchAllBrands(),
    ]);

    const brandMap = {};
    for (const brand of allBrands) {
      brandMap[String(brand.id)] = brand.name || "";
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
      if (!Array.isArray(product.images) || product.images.length === 0) {
        return "";
      }

      // Bevorzuge bewusst das 2. Bild
      const preferredImage =
        product.images[1] ||
        product.images.find((img) => img.url_zoom) ||
        product.images.find((img) => img.url_standard) ||
        product.images[0];

      return (
        preferredImage?.url_zoom ||
        preferredImage?.url_standard ||
        preferredImage?.url_thumbnail ||
        ""
      );
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

      const resolvedBrand =
        product.brand_name ||
        brandMap[String(product.brand_id || "")] ||
        customFieldMap.brand ||
        "";

      const gtin = customFieldMap.gtin || product.upc || "";
      const mpn = customFieldMap.mpn || product.sku || "";
      const googleProductCategory =
        customFieldMap.google_product_category || "";
      const productType = customFieldMap.product_type || "";

      // DEINE gewünschte Logik:
      // Wenn sale_price existiert, dann kommt der reduzierte Preis ins Feld "price"
      // und sale_price bleibt leer, damit Channable den aktuellen Preis sauber zeigt.
      let finalPrice = "";
      let salePrice = "";

      if (product.sale_price != null && Number(product.sale_price) > 0) {
        finalPrice = `${Number(product.sale_price).toFixed(2)} EUR`;
        salePrice = "";
      } else {
        finalPrice =
          product.price != null
            ? `${Number(product.price).toFixed(2)} EUR`
            : "";
        salePrice = "";
      }

      const row = [
        escapeCsv(product.id),
        escapeCsv(product.name || ""),
        escapeCsv(stripHtml(product.description || product.name || "")),
        escapeCsv(buildProductUrl(product)),
        escapeCsv(buildImageUrl(product)),
        escapeCsv(normalizeAvailability(product)),
        escapeCsv(finalPrice),
        escapeCsv(salePrice),
        escapeCsv(resolvedBrand),
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
