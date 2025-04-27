// netlify/functions/submit-review.js
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://mamamary.io'; // Fallback to default
const shopifyApiVersion = '2024-10'; // Adjust if needed

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (error) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body', details: error.message }),
    };
  }

  const { productId, name, text, stars } = payload;

  if (!productId || !name || !text || !stars) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required fields' }),
    };
  }

  const adminApiAccessToken = process.env.ADMIN_API_ACCESS_TOKEN;
  const shop = process.env.SHOP;

  if (!adminApiAccessToken || !shop) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server misconfiguration: Missing environment variables' }),
    };
  }

  try {
    const existingReviews = await fetchReviews(productId, shop, adminApiAccessToken);
    const updatedReviews = [
      ...(existingReviews || []),
      {
        name,
        text,
        stars: parseInt(stars, 10),
        status: 'pending',
        date: new Date().toISOString(),
      },
    ];

    const updateResult = await updateReviews(productId, updatedReviews, shop, adminApiAccessToken);

    if (updateResult?.data?.metafieldUpsert?.userErrors?.length > 0) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to update reviews', details: updateResult.data.metafieldUpsert.userErrors }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Review submitted successfully' }),
    };
  } catch (error) {
    console.error('Error submitting review:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'An unexpected error occurred', details: error.message }),
    };
  }
};

// Fetch existing reviews
async function fetchReviews(productId, shop, token) {
  const query = `
    query {
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
    throw new Error(`Failed to fetch reviews: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const metafield = data?.data?.product?.metafield;

  return metafield?.value ? JSON.parse(metafield.value) : [];
}

// Update reviews
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

  const response = await fetch(`https://[${shop}](mailto:shop)/admin/api/${shopifyApiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update reviews: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
