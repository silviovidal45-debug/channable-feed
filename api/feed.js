export default async function handler(req, res) {
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  const accessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;

  if (!storeHash || !accessToken) {
    return res.status(500).send("Missing environment variables");
  }

  try {
    let page = 1;
    let allProducts = [];

    while (true) {
      const response = await fetch(
        `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products?limit=250&page=${page}&include=custom_fields`,
        {
          headers: {
            "X-Auth-Token": accessToken,
            "Accept": "application/json",
            "Content-Type": "application/json"
          }
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).send(`BigCommerce API error: ${errorText}`);
      }

      const json = await response.json();
      const products = json.data || [];

      allProducts = allProducts.concat(products);

      if (products.length < 250) break;
      page++;
    }

    const filtered = allProducts.filter(product =>
      Array.isArray(product.custom_fields) &&
      product.custom_fields.some(
        field =>
          String(field.name).toLowerCase() === "channable" &&
          String(field.value).toLowerCase() === "yes"
      )
    );

    const escapeCsv = (value) => {
      const str = value == null ? "" : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    let csv = [
      [
        "id",
        "title",
        "description",
        "price",
        "link",
        "image_link",
        "brand",
        "availability",
        "condition",
        "sku"
      ].join(",")
    ];

    filtered.forEach(product => {
      const row = [
        product.id,
        escapeCsv(product.name),
        escapeCsv(product.description),
        product.price ?? "",
        escapeCsv(product.custom_url?.url ? `https://${process.env.STOREFRONT_DOMAIN}${product.custom_url.url}` : ""),
        escapeCsv(product.primary_image?.url_standard || ""),
        escapeCsv(product.brand_name || ""),
        escapeCsv(product.availability || ""),
        escapeCsv("new"),
        escapeCsv(product.sku || "")
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
// deploy trigger
