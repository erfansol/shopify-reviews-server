const fetch = require('node-fetch'); // Fetch is built-in on Netlify

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { productId, name, text, stars } = JSON.parse(event.body);

  if (!productId || !name || !text || !stars) {
    return { statusCode: 400, body: 'Missing required fields' };
  }

  const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;
  const SHOP = process.env.SHOP;

  try {
    const queryGet = `
      {
        product(id: "gid://shopify/Product/${productId}") {
          metafield(namespace: "custom", key: "reviews") {
            id
            value
          }
        }
      }
    `;

    const getResponse = await fetch(`https://${SHOP}/admin/api/2023-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN
      },
      body: JSON.stringify({ query: queryGet })
    });

    const getResult = await getResponse.json();
    const metafield = getResult.data.product.metafield;
    let reviews = [];

    if (metafield && metafield.value) {
      reviews = JSON.parse(metafield.value);
    }

    reviews.push({
      name,
      text,
      stars,
      status: "pending",
      date: new Date().toISOString()
    });

    const mutationUpdate = `
      mutation MetafieldUpdate {
        metafieldUpdate(input: {
          id: "${metafield.id}",
          value: "${JSON.stringify(reviews).replace(/"/g, '\\"')}",
          valueType: JSON
        }) {
          metafield {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const updateResponse = await fetch(`https://${SHOP}/admin/api/2023-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN
      },
      body: JSON.stringify({ query: mutationUpdate })
    });

    const updateResult = await updateResponse.json();

    if (updateResult.data.metafieldUpdate.userErrors.length > 0) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: updateResult.data.metafieldUpdate.userErrors })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Review submitted successfully" })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
