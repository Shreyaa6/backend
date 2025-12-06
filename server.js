import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';

dotenv.config();

const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const FRONTEND_URLS = (process.env.FRONTEND_URLS || FRONTEND_URL)
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
const allowAll = FRONTEND_URLS.includes('*');

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowAll) return callback(null, true);
    if (FRONTEND_URLS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDpaE7aI73ROnxWnP-Fe7yEolVTtCqeDGg';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '85c7d87effmsh63cf2d93801c02bp1a6854jsn90dcf15b1890';
const EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY || '9ea2e355dc46cdf4585fbc76';

// Initialize Gemini AI
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'Hiraeth API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      signup: '/api/auth/signup',
      login: '/api/auth/login',
      me: '/api/auth/me',
      geminiChat: '/api/gemini/chat',
      geminiGenerateText: '/api/gemini/generate-text',
      geminiTripSuggestions: '/api/gemini/trip-suggestions',
      flights: '/api/flights/search',
      trains: '/api/trains/stations',
      hotels: '/api/hotels/airbnb',
      restaurants: '/api/places/restaurants',
      weather: '/api/weather/forecast',
      exchange: '/api/exchange/rates',
      tripPlan: '/api/trips/plan'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Debug route to list all available routes
app.get('/api/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      routes.push({
        method: Object.keys(middleware.route.methods)[0].toUpperCase(),
        path: middleware.route.path
      });
    }
  });
  res.json({ success: true, routes });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, username, and password are required' 
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { username }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: existingUser.email === email 
          ? 'Email already registered' 
          : 'Username already taken' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword
      },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true
      }
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user,
      token
    });
  } catch (error) {
    console.error('Signup error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV ? error.stack : undefined
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required' 
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    req.user = user;
    next();
  });
};

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/test-db', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ 
      success: true, 
      message: 'Database connection successful' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Database connection failed',
      error: error.message 
    });
  }
});

// Gemini AI Routes
app.post('/api/gemini/chat', async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({
        success: false,
        message: 'Gemini API not configured'
      });
    }

    const { message, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    // Build conversation history
    const chatHistory = history.map(msg => ({
      role: msg.role || 'user',
      parts: [{ text: msg.text || msg.content }]
    }));

    // Start chat with history if available
    const chat = chatHistory.length > 0 
      ? model.startChat({ history: chatHistory })
      : model;

    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    res.json({
      success: true,
      message: text,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0
      }
    });
  } catch (error) {
    console.error('Gemini API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get response from Gemini',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/gemini/generate-text', async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({
        success: false,
        message: 'Gemini API not configured'
      });
    }

    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required'
      });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    res.json({
      success: true,
      text: text,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0
      }
    });
  } catch (error) {
    console.error('Gemini API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate text',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/gemini/trip-suggestions', async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({
        success: false,
        message: 'Gemini API not configured'
      });
    }

    const { destination, duration, budget, interests } = req.body;

    if (!destination) {
      return res.status(400).json({
        success: false,
        message: 'Destination is required'
      });
    }

    const prompt = `Create a detailed travel itinerary for ${destination}${duration ? ` for ${duration} days` : ''}${budget ? ` with a budget of ${budget}` : ''}${interests ? `. Interests: ${interests.join(', ')}` : ''}. Include:
1. Day-by-day itinerary with activities
2. Recommended places to visit
3. Restaurant suggestions
4. Transportation tips
5. Budget breakdown
6. Travel tips

Format the response as a structured JSON object with the following structure:
{
  "itinerary": [
    {
      "day": 1,
      "activities": ["activity1", "activity2"],
      "places": ["place1", "place2"],
      "restaurants": ["restaurant1", "restaurant2"]
    }
  ],
  "budget": {
    "accommodation": "amount",
    "food": "amount",
    "transportation": "amount",
    "activities": "amount",
    "total": "amount"
  },
  "tips": ["tip1", "tip2"]
}`;

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Try to parse JSON from response
    let suggestions;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
      const jsonText = jsonMatch ? jsonMatch[1] : text;
      suggestions = JSON.parse(jsonText);
    } catch (e) {
      // If parsing fails, return as text
      suggestions = { raw: text };
    }

    res.json({
      success: true,
      suggestions: suggestions,
      raw: text,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0
      }
    });
  } catch (error) {
    console.error('Gemini API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate trip suggestions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// RapidAPI Routes
// Flights
app.get('/api/flights/search', async (req, res) => {
  try {
    const { departure_id, arrival_id, travel_class = 'ECONOMY', adults = 1, currency = 'USD', language_code = 'en-US', country_code = 'US' } = req.query;
    
    if (!departure_id || !arrival_id) {
      return res.status(400).json({ success: false, message: 'Departure and arrival IDs are required' });
    }

    const response = await axios.get('https://google-flights2.p.rapidapi.com/api/v1/searchFlights', {
      params: {
        departure_id,
        arrival_id,
        travel_class,
        adults,
        show_hidden: 1,
        currency,
        language_code,
        country_code,
        search_type: 'best'
      },
      headers: {
        'x-rapidapi-host': 'google-flights2.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Flights API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch flights',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Trains
app.get('/api/trains/stations', async (req, res) => {
  try {
    const { hours = 1 } = req.query;
    
    const response = await axios.get('https://irctc1.p.rapidapi.com/api/v3/getLiveStation', {
      params: { hours },
      headers: {
        'x-rapidapi-host': 'irctc1.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Trains API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch train stations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Hotels - Airbnb
app.get('/api/hotels/airbnb', async (req, res) => {
  try {
    const { placeId, adults = 1, currency = 'USD' } = req.query;
    
    if (!placeId) {
      return res.status(400).json({ success: false, message: 'Place ID is required' });
    }

    const response = await axios.get('https://airbnb19.p.rapidapi.com/api/v2/searchPropertyByPlaceId', {
      params: {
        placeId,
        adults,
        guestFavorite: false,
        ib: false,
        currency
      },
      headers: {
        'x-rapidapi-host': 'airbnb19.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Hotels API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hotels',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Places - TripAdvisor
app.get('/api/places/restaurants', async (req, res) => {
  try {
    const { locationId } = req.query;
    
    if (!locationId) {
      return res.status(400).json({ success: false, message: 'Location ID is required' });
    }

    const response = await axios.get('https://tripadvisor16.p.rapidapi.com/api/v1/restaurant/searchRestaurants', {
      params: { locationId },
      headers: {
        'x-rapidapi-host': 'tripadvisor16.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Places API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch restaurants',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Weather
app.get('/api/weather/forecast', async (req, res) => {
  try {
    const { place, cnt = 3, units = 'standard', lang = 'en' } = req.query;
    
    if (!place) {
      return res.status(400).json({ success: false, message: 'Place is required' });
    }

    const response = await axios.get('https://weather-api167.p.rapidapi.com/api/weather/forecast', {
      params: {
        place,
        cnt,
        units,
        type: 'three_hour',
        mode: 'json',
        lang
      },
      headers: {
        'Accept': 'application/json',
        'x-rapidapi-host': 'weather-api167.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Weather API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch weather',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Currency Exchange
app.get('/api/exchange/rates', async (req, res) => {
  try {
    const { base = 'USD' } = req.query;
    
    const response = await axios.get(`https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/latest/${base}`);
    
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Exchange API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exchange rates',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// AI Trip Planner
app.post('/api/trips/plan', async (req, res) => {
  try {
    const { days, destination, interests, budget, travelMode } = req.body;
    
    if (!destination) {
      return res.status(400).json({ success: false, message: 'Destination is required' });
    }

    const response = await axios.post('https://ai-trip-planner.p.rapidapi.com/detailed-plan', {
      days: days || 3,
      destination,
      interests: interests || [],
      budget: budget || 'medium',
      travelMode: travelMode || 'public transport'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'ai-trip-planner.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Trip Planner API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate trip plan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    success: false, 
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

let server;
if (!process.env.VERCEL) {
  server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Frontend URL: ${FRONTEND_URL}`);
    console.log(`💾 Database: Connected`);
  });

  process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(async () => {
      console.log('HTTP server closed');
      await prisma.$disconnect();
      process.exit(0);
    });
  });

  process.on('SIGINT', async () => {
    console.log('\nSIGINT signal received: closing HTTP server');
    server.close(async () => {
      console.log('HTTP server closed');
      await prisma.$disconnect();
      process.exit(0);
    });
  });

  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
}

export default app;



