// netlify/functions/submit-review.js
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://mamamary.io';
const shopifyApiVersion = '2024-10';

exports.handler = async (event, context) => {
  console.log('Function invoked:', { method: event.httpMethod, body: event.body });

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    console.log('Returning OPTIONS response');
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  // Allow only POST requests
  if (event.httpMethod !== 'POST') {
    console.log('Invalid method:', event.httpMethod);
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  // Parse request body
  let payload;
  try {
    console.log('Parsing request body:', event.body);
    payload = JSON.parse(event.body);
  } catch (error) {
    console.error('JSON parse error:', error.message);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body', details: error.message }),
    };
  }

  const { productId, name, text, stars } = payload;
  console.log('Parsed payload:', { productId, name, text, stars });

  // Validate required fields
  if (!productId || !name || !text || !stars) {
    console.log('Missing required fields:', { productId, name, text, stars });
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required fields' }),
    };
  }

  // Validate environment variables
  const adminApiAccessToken = process.env.ADMIN_API_ACCESS_TOKEN;
  const shop = process.env.SHOP;
  console.log('Environment variables:', {
    shop,
    hasToken: !!adminApiAccessToken,
    allowedOrigin,
  });

  if (!adminApiAccessToken || !shop) {
    console.error('Missing environment variables:', {
      hasShop: !!shop,
      hasToken: !!adminApiAccessToken,
    });
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server misconfiguration: Missing environment variables' }),
    };
  }

  try {
    console.log('Fetching reviews for productId:', productId);
    const existingReviews = await fetchReviews(productId, shop, adminApiAccessToken);

    console.log('Existing reviews:', existingReviews);
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

    console.log('Updating reviews:', updatedReviews);
    const updateResult = await updateReviews(productId, updatedReviews, shop, adminApiAccessToken);

    // Check for GraphQL errors or userErrors
    if (updateResult.errors?.length > 0) {
      console.error('GraphQL errors:', updateResult.errors);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to update reviews', details: updateResult.errors }),
      };
    }
    if (updateResult.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('MetafieldsSet user errors:', updateResult.data.metafieldsSet.userErrors);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Failed to update reviews',
          details: updateResult.data.metafieldsSet.userErrors,
        }),
      };
    }

    console.log('Review submitted successfully');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Review submitted successfully' }),
    };
  } catch (error) {
    console.error('Error in submit-review:', {
      message: error.message,
      stack: error.stack,
    });
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'An unexpected error occurred',
        details: error.message,
      }),
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

  console.log('Fetching reviews from:', `https://${shop}/admin/api/${shopifyApiVersion}/graphql.json`);
  console.log('Query:', query);

  try {
    const response = await fetch(`https://${shop}/admin/api/${shopifyApiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query }),
    });

    console.log('Fetch reviews response status:', response.status);
    if (!response.ok) {
      const text = await response.text();
      console.error('Fetch reviews error response:', text);
      throw new Error(`Failed to fetch reviews: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Fetch reviews response data:', data);

    const metafield = data?.data?.product?.metafield;
    return metafield?.value ? JSON.parse(metafield.value) : [];
  } catch (error) {
    console.error('Error fetching reviews:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

// Update reviews using metafieldsSet
async function updateReviews(productId, reviews, shop, token) {
  const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
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
    metafields: [
      {
        namespace: 'custom',
        key: 'reviews',
        ownerId: `gid://shopify/Product/${productId}`,
        type: 'json',
        value: JSON.stringify(reviews),
      },
    ],
  };

  console.log('Updating reviews to:', `https://${shop}/admin/api/${shopifyApiVersion}/graphql.json`);
  console.log('Query:', query, 'Variables:', variables);

  try {
    const response = await fetch(`https://${shop}/admin/api/${shopifyApiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });

    console.log('Update reviews response status:', response.status);
    if (!response.ok) {
      const text = await response.text();
      console.error('Update reviews error response:', text);
      throw new Error(`Failed to update reviews: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Update reviews response data:', data);
    return data;
  } catch (error) {
    console.error('Error updating reviews:', {
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
