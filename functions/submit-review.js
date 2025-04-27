import fetch from 'node-fetch';

const allowedOrigin = 'https://mamamary.io'; // Change to your domain
const shopifyApiVersion = '2023-10';

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders(),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
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
    // Fetch existing reviews from the Shopify product metafield
    const existingReviews = await fetchReviews(productId, SHOP, ADMIN_API_ACCESS_TOKEN);

    const updatedReviews = [
      ...(existingReviews || []),
      {
        name,
        text,
        stars,
        status: 'pending', // You can change this status based on your review approval flow
        date: new Date().toISOString(),
      },
    ];

    // Update reviews in the Shopify metafield
    const updateResult = await updateReviews(productId, updatedReviews, SHOP, ADMIN_API_ACCESS_TOKEN);

    if (updateResult.errors && updateResult.errors.length > 0) {
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
    console.error('Error occurred:', error);  // Log the error for debugging
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'An unexpected error occurred' }),
    };
  }
};

// --- Helper Functions ---

// CORS headers function
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': allowedOrigin, // Make sure this is set to the correct allowed origin
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Fetch existing reviews for the given productId
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

  if (!response.ok) {
    throw new Error('Failed to fetch existing reviews');
  }

  const data = await response.json();
  const metafield = data?.data?.product?.metafield;

  if (!metafield) return [];  // Return an empty array if no metafield is found
  return JSON.parse(metafield.value || '[]');
}

// Update the reviews for the product in the metafield
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
      namespace: 'custom',
      key: 'reviews',
      ownerId: `gid://shopify/Product/${productId}`,
      type: 'json',
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

  if (!response.ok) {
    throw new Error('Failed to update reviews');
  }

  return response.json();
}
