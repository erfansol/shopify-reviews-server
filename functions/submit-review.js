import fetch from 'node-fetch';

const allowedOrigin = 'https://mamamary.io'; // Change to your domain
const shopifyApiVersion = '2023-10';

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: '',
    };
  }

  // Allow only POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { productId, name, text, stars } = payload;

  if (!productId || !name || !text || !stars) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Missing required fields' }),
    };
  }

  const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;
  const SHOP = process.env.SHOP;

  if (!ADMIN_API_ACCESS_TOKEN || !SHOP) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Server misconfiguration' }),
    };
  }

  try {
    const existingReviews = await fetchReviews(productId, SHOP, ADMIN_API_ACCESS_TOKEN);
    const updatedReviews = [
      ...(existingReviews || []),
      {
        name,
        text,
        stars,
        status: 'pending',
        date: new Date().toISOString(),
      },
    ];

    const updateResult = await updateReviews(productId, updatedReviews, SHOP, ADMIN_API_ACCESS_TOKEN);

    if (updateResult.errors) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: updateResult.errors }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Review submitted successfully' }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message }),
    };
  }
};

// --- Helper Functions ---

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function fetchReviews(productId, shop, token) {
  const query = `
    {
      product(id: "gid://shopify/Product/${productId}") {
        metafield(namespace: "custom", key: "reviews") {
          id
          value
        }
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/${shopifyApiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  const metafield = data?.data?.product?.metafield;

  if (!metafield) return null;
  return JSON.parse(metafield.value || '[]');
}

async function updateReviews(productId, reviews, shop, token) {
  const query = `
    mutation metafieldUpsert($input: MetafieldInput!) {
      metafieldUpsert(input: $input) {
        metafield {
          id
          namespace
          key
          value
          type
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      namespace: "custom",
      key: "reviews",
      ownerId: `gid://shopify/Product/${productId}`,
      type: "json",
      value: JSON.stringify(reviews),
    },
  };

  const response = await fetch(`https://${shop}/admin/api/${shopifyApiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  return response.json();
}
