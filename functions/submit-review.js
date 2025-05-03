// Import node-fetch (CommonJS version)
const fetch = require('node-fetch');

// Environment variables
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://mamamary.io';
const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';
const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
const adminApiAccessToken = process.env.ADMIN_API_ACCESS_TOKEN;
const shop = process.env.SHOP;

// Input sanitization to reduce XSS risks
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/[<>"'&]/g, (match) => ({
      '<': '<',
      '>': '>',
      '"': '"',
      "'": ''',
      '&': '&'
    }[match]))
    .trim();
};

// Main handler
exports.handler = async (event, context) => {
  console.log('Function invoked:', { method: event.httpMethod, body: event.body });

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle OPTIONS for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    console.log('Returning OPTIONS response');
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  // Allow only POST requests
  if (event.httpMethod !== 'POST') {
    console.log('Invalid method:', event.httpMethod);
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' })
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
      body: JSON.stringify({ error: 'Invalid JSON body', details: error.message })
    };
  }

  const { productId, name, text, stars, recaptchaResponse } = payload;
  console.log('Parsed payload:', { productId, name, text, stars, recaptchaResponse });

  // Validate required fields
  if (!productId || !name || !text || !stars || !recaptchaResponse) {
    console.log('Missing required fields:', { productId, name, text, stars, recaptchaResponse });
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required fields' })
    };
  }

  // Validate stars
  const starsNum = parseInt(stars, 10);
  if (isNaN(starsNum) || starsNum < 1 || starsNum > 5) {
    console.log('Invalid stars value:', stars);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Stars must be a number between 1 and 5' })
    };
  }

  // Validate environment variables
  if (!adminApiAccessToken || !shop || !recaptchaSecret) {
    console.error('Missing environment variables:', {
      hasShop: !!shop,
      hasToken: !!adminApiAccessToken,
      hasRecaptchaSecret: !!recaptchaSecret
    });
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server misconfiguration: Missing environment variables' })
    };
  }

  // Verify reCAPTCHA v2 Checkbox
  console.log('Verifying reCAPTCHA v2 Checkbox');
  const recaptchaVerifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecret}&response=${recaptchaResponse}`;
  try {
    const recaptchaResult = await fetch(recaptchaVerifyUrl, { method: 'POST' });
    const recaptchaData = await recaptchaResult.json();
    console.log('reCAPTCHA v2 verification result:', recaptchaData);

    if (!recaptchaData.success) {
      console.log('reCAPTCHA v2 verification failed:', { success: recaptchaData.success, errors: recaptchaData['error-codes'] });
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'reCAPTCHA verification failed',
          details: recaptchaData['error-codes'] || 'Invalid reCAPTCHA response'
        })
      };
    }
    console.log('reCAPTCHA v2 verification successful');
  } catch (error) {
    console.error('reCAPTCHA v2 verification error:', error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to verify reCAPTCHA', details: error.message })
    };
  }

  // Sanitize inputs
  const sanitizedName = sanitizeInput(name);
  const sanitizedText = sanitizeInput(text);
  console.log('Sanitized inputs:', { sanitizedName, sanitizedText });

  try {
    console.log('Fetching reviews for productId:', productId);
    const existingReviews = await fetchReviews(productId, shop, adminApiAccessToken);

    console.log('Existing reviews:', existingReviews);
    const updatedReviews = [
      ...(existingReviews || []),
      {
        name: sanitizedName,
        text: sanitizedText,
        stars: starsNum,
        status: 'pending',
        date: new Date().toISOString()
      }
    ];

    console.log('Updating reviews:', updatedReviews);
    const updateResult = await updateReviews(productId, updatedReviews, shop, adminApiAccessToken);

    if (updateResult.errors?.length > 0) {
      console.error('GraphQL errors:', updateResult.errors);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to update reviews', details: updateResult.errors })
      };
    }
    if (updateResult.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('MetafieldsSet user errors:', updateResult.data.metafieldsSet.userErrors);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Failed to update reviews',
          details: updateResult.data.metafieldsSet.userErrors
        })
      };
    }

    console.log('Review submitted successfully');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Review submitted successfully' })
    };
  } catch (error) {
    console.error('Error in submit-review:', {
      message: error.message,
      stack: error.stack
    });
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'An unexpected error occurred',
        details: error.message
      })
    };
  }
};

// Fetch existing reviews
async function fetchReviews(productId, shop, token) {
  if (!productId.match(/^\d+$/)) {
    throw new Error('Invalid productId format');
  }

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
        'X-Shopify-Access-Token': token
      },
      body: JSON.stringify({ query })
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
      stack: error.stack
    });
    throw error;
  }
}

// Update reviews using metafieldsSet
async function updateReviews(productId, reviews, shop, token) {
  if (!productId.match(/^\d+$/)) {
    throw new Error('Invalid productId format');
  }

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
        value: JSON.stringify(reviews)
      }
    ]
  };

  console.log('Updating reviews to:', `https://${shop}/admin/api/${shopifyApiVersion}/graphql.json`);
  console.log('Query:', query, 'Variables:', variables);

  try {
    const response = await fetch(`https://${shop}/admin/api/${shopifyApiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
      },
      body: JSON.stringify({ query, variables })
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
      stack: error.stack
    });
    throw error;
  }
}
