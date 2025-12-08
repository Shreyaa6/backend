import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
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
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow all in development mode or if explicitly set
    const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    if (allowAll || isDevelopment) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (FRONTEND_URLS.includes(origin)) {
      return callback(null, true);
    }
    
    // Log the rejected origin for debugging
    console.log('CORS blocked origin:', origin);
    console.log('Allowed origins:', FRONTEND_URLS);
    console.log('Development mode:', isDevelopment);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};
const JWT_SECRET = process.env.JWT_SECRET;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY ;
const EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY ;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ;

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
      flights: '/api/flights/search',
      trains: '/api/trains/stations',
      cars: '/api/cars/search',
      buses: '/api/buses/generate',
      hotels: '/api/hotels/search',
      hotelLocations: '/api/hotels/locations',
      restaurants: '/api/places/restaurants',
      weather: '/api/weather/forecast',
      exchange: '/api/exchange/rates',
      tripPlan: '/api/trips/plan',
      trips: '/api/trips',
      trip: '/api/trips/:id'
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

// Trip Routes
app.post('/api/trips', authenticateToken, async (req, res) => {
  try {
    const { destination, transportationType, transportationData, hotelData, startDate, endDate, travelers } = req.body;

    if (!destination || !transportationType || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Destination, transportation type, start date, and end date are required'
      });
    }

    const trip = await prisma.trip.create({
      data: {
        userId: req.user.userId,
        destination,
        transportationType,
        transportationData: transportationData || null,
        hotelData: hotelData || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        travelers: travelers || 1,
        status: 'upcoming'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Trip created successfully',
      trip
    });
  } catch (error) {
    console.error('Create trip error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta
    });
    
    // Handle Prisma errors
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'A trip with these details already exists'
      });
    }
    
    if (error.code === 'P2003') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID. Please login again.'
      });
    }
    
    if (error.message && error.message.includes('Unknown column')) {
      return res.status(500).json({
        success: false,
        message: 'Database schema mismatch. Please run migrations: npx prisma migrate dev'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create trip',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        meta: error.meta
      } : undefined
    });
  }
});

app.get('/api/trips', authenticateToken, async (req, res) => {
  try {
    const trips = await prisma.trip.findMany({
      where: {
        userId: req.user.userId
      },
      orderBy: {
        startDate: 'asc'
      }
    });

    res.json({
      success: true,
      trips
    });
  } catch (error) {
    console.error('Get trips error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trips',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/trips/:id', authenticateToken, async (req, res) => {
  try {
    const trip = await prisma.trip.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.user.userId
      }
    });

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      });
    }

    res.json({
      success: true,
      trip
    });
  } catch (error) {
    console.error('Get trip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trip',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.put('/api/trips/:id', authenticateToken, async (req, res) => {
  try {
    const { destination, transportationType, transportationData, hotelData, startDate, endDate, travelers, status } = req.body;
    
    const existingTrip = await prisma.trip.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.user.userId
      }
    });

    if (!existingTrip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      });
    }

    const trip = await prisma.trip.update({
      where: {
        id: parseInt(req.params.id)
      },
      data: {
        ...(destination && { destination }),
        ...(transportationType && { transportationType }),
        ...(transportationData !== undefined && { transportationData }),
        ...(hotelData !== undefined && { hotelData }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(travelers && { travelers }),
        ...(status && { status })
      }
    });

    res.json({
      success: true,
      message: 'Trip updated successfully',
      trip
    });
  } catch (error) {
    console.error('Update trip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update trip',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.delete('/api/trips/:id', authenticateToken, async (req, res) => {
  try {
    const existingTrip = await prisma.trip.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.user.userId
      }
    });

    if (!existingTrip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      });
    }

    await prisma.trip.delete({
      where: {
        id: parseInt(req.params.id)
      }
    });

    res.json({
      success: true,
      message: 'Trip deleted successfully'
    });
  } catch (error) {
    console.error('Delete trip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete trip',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Budget CRUD Routes
app.get('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const budgets = await prisma.budget.findMany({
      where: {
        userId: req.user.userId
      },
      include: {
        trip: {
          select: {
            id: true,
            destination: true,
            startDate: true,
            endDate: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      success: true,
      budgets
    });
  } catch (error) {
    console.error('Get budgets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budgets',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/budgets/:id', authenticateToken, async (req, res) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.user.userId
      },
      include: {
        trip: {
          select: {
            id: true,
            destination: true,
            startDate: true,
            endDate: true
          }
        }
      }
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found'
      });
    }

    res.json({
      success: true,
      budget
    });
  } catch (error) {
    console.error('Get budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const { name, accommodation, food, transportation, activities, miscellaneous, currency, tripId } = req.body;

    const budget = await prisma.budget.create({
      data: {
        userId: req.user.userId,
        name: name || 'My Budget',
        accommodation: parseFloat(accommodation) || 0,
        food: parseFloat(food) || 0,
        transportation: parseFloat(transportation) || 0,
        activities: parseFloat(activities) || 0,
        miscellaneous: parseFloat(miscellaneous) || 0,
        currency: currency || 'USD',
        ...(tripId && { tripId: parseInt(tripId) })
      },
      include: {
        trip: {
          select: {
            id: true,
            destination: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Budget created successfully',
      budget
    });
  } catch (error) {
    console.error('Create budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create budget',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.put('/api/budgets/:id', authenticateToken, async (req, res) => {
  try {
    const { name, accommodation, food, transportation, activities, miscellaneous, currency, tripId } = req.body;

    const existingBudget = await prisma.budget.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.user.userId
      }
    });

    if (!existingBudget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found'
      });
    }

    const budget = await prisma.budget.update({
      where: {
        id: parseInt(req.params.id)
      },
      data: {
        ...(name !== undefined && { name }),
        ...(accommodation !== undefined && { accommodation: parseFloat(accommodation) }),
        ...(food !== undefined && { food: parseFloat(food) }),
        ...(transportation !== undefined && { transportation: parseFloat(transportation) }),
        ...(activities !== undefined && { activities: parseFloat(activities) }),
        ...(miscellaneous !== undefined && { miscellaneous: parseFloat(miscellaneous) }),
        ...(currency !== undefined && { currency }),
        ...(tripId !== undefined && { tripId: tripId ? parseInt(tripId) : null })
      },
      include: {
        trip: {
          select: {
            id: true,
            destination: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Budget updated successfully',
      budget
    });
  } catch (error) {
    console.error('Update budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update budget',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.delete('/api/budgets/:id', authenticateToken, async (req, res) => {
  try {
    const existingBudget = await prisma.budget.findFirst({
      where: {
        id: parseInt(req.params.id),
        userId: req.user.userId
      }
    });

    if (!existingBudget) {
      return res.status(404).json({
        success: false,
        message: 'Budget not found'
      });
    }

    await prisma.budget.delete({
      where: {
        id: parseInt(req.params.id)
      }
    });

    res.json({
      success: true,
      message: 'Budget deleted successfully'
    });
  } catch (error) {
    console.error('Delete budget error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete budget',
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

// Cars - Car Rentals
app.get('/api/cars/search', async (req, res) => {
  try {
    const { 
      pick_up_latitude, 
      pick_up_longitude, 
      drop_off_latitude, 
      drop_off_longitude, 
      pick_up_datetime, 
      drop_off_datetime, 
      driver_age = 30, 
      currency_code = 'USD', 
      location = 'US' 
    } = req.query;
    
    if (!pick_up_latitude || !pick_up_longitude || !pick_up_datetime || !drop_off_datetime) {
      return res.status(400).json({ 
        success: false, 
        message: 'Pick-up location (lat/lng), drop-off location (lat/lng), and dates are required' 
      });
    }

    const response = await axios.get('https://booking-com15.p.rapidapi.com/api/v1/cars/searchCarRentals', {
      params: {
        pick_up_latitude,
        pick_up_longitude,
        drop_off_latitude: drop_off_latitude || pick_up_latitude,
        drop_off_longitude: drop_off_longitude || pick_up_longitude,
        pick_up_datetime,
        drop_off_datetime,
        driver_age,
        currency_code,
        location
      },
      headers: {
        'x-rapidapi-host': 'booking-com15.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Cars API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch car rentals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Buses - Bus Timetable Generator
app.post('/api/buses/generate', async (req, res) => {
  try {
    const response = await axios.post('https://bus-timetable-generator-v1.p.rapidapi.com/rapidapi/generate-with-default-files/', 
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-host': 'bus-timetable-generator-v1.p.rapidapi.com',
          'x-rapidapi-key': RAPIDAPI_KEY
        }
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Buses API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate bus timetable',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Hotels - Booking.com
// Health check for hotels endpoint
app.get('/api/hotels', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Hotels API is available',
    endpoints: {
      search: '/api/hotels/search',
      locations: '/api/hotels/locations'
    }
  });
});

// Helper function to generate mock hotel data
const generateMockHotels = (cityName, checkInDate, checkOutDate, adults) => {
  const hotelNames = [
    `${cityName} Grand Hotel`,
    `${cityName} Beach Resort`,
    `${cityName} City Center Hotel`,
    `${cityName} Luxury Suites`,
    `${cityName} Boutique Inn`,
    `${cityName} Garden Hotel`,
    `${cityName} Riverside Lodge`,
    `${cityName} Plaza Hotel`,
    `${cityName} Heritage Inn`,
    `${cityName} Modern Stay`
  ];

  const amenities = ['WiFi', 'Pool', 'Spa', 'Gym', 'Restaurant', 'Bar', 'Parking', 'Airport Shuttle'];
  const ratings = [4.0, 4.2, 4.5, 4.7, 4.8, 5.0];

  return hotelNames.map((name, idx) => {
    const basePrice = 50 + Math.floor(Math.random() * 200);
    const nights = Math.ceil((new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24)) || 1;
    const totalPrice = basePrice * nights * adults;
    
    return {
      hotel_id: idx + 1,
      hotel_name: name,
      hotel_name_trans: name,
      address: `${Math.floor(Math.random() * 999) + 1} Main Street, ${cityName}`,
      review_score: ratings[Math.floor(Math.random() * ratings.length)],
      review_score_word: 'Very Good',
      price_breakdown: {
        gross_price: totalPrice,
        all_inclusive_price: totalPrice * 1.1
      },
      min_total_price: totalPrice,
      main_photo_url: `https://picsum.photos/seed/hotel${cityName}${idx}/400/300`,
      distance_to_cc: (Math.random() * 5).toFixed(1),
      room_types: [{
        bed_configurations: [{ beds: Math.floor(Math.random() * 3) + 1 }],
        bathrooms: Math.floor(Math.random() * 2) + 1
      }]
    };
  });
};

app.get('/api/hotels/search', async (req, res) => {
  try {
    const { 
      dest_id, 
      dest_type = 'city',
      checkin_date, 
      checkout_date, 
      adults_number = 2, 
      room_number = 1,
      currency = 'USD',
      city_name // New parameter for city name
    } = req.query;
    
    if (!checkin_date || !checkout_date) {
      return res.status(400).json({ 
        success: false, 
        message: 'Check-in date and check-out date are required' 
      });
    }

    // City name mapping from dest_id (fallback if city_name not provided)
    const cityMap = {
      '-2637882': 'New York',
      '-1456928': 'Paris',
      '-2601889': 'London',
      '-246227': 'Tokyo',
      '-782831': 'Dubai',
      '-256230': 'Bali',
      '-304554': 'Goa',
      '-2100945': 'Delhi',
      '-2090174': 'Mumbai',
      '-293921': 'Bangkok',
      '-390625': 'Singapore',
      '-1603135': 'Sydney',
      '-122590': 'Los Angeles',
      '-1580749': 'San Francisco',
      '-126693': 'Rome',
      '-372490': 'Barcelona',
      '-2140479': 'Amsterdam',
      '-1746443': 'Berlin'
    };

    const cityName = city_name || cityMap[dest_id] || 'Destination';

    // Try OpenRouter if API key is provided
    if (OPENROUTER_API_KEY) {
      try {
        const prompt = `Generate a JSON array of 10 hotel recommendations for ${cityName} from ${checkin_date} to ${checkout_date} for ${adults_number} adults. 
        Each hotel should have: hotel_name, address, price_per_night (USD), rating (1-5), amenities (array), description (brief).
        Return ONLY valid JSON array, no markdown, no code blocks.`;

        const openRouterResponse = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model: 'openai/gpt-3.5-turbo',
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 2000
          },
          {
            headers: {
              'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'http://localhost:4000',
              'X-Title': 'Hiraeth Travel App'
            },
            timeout: 30000
          }
        );

        const aiResponse = openRouterResponse.data.choices[0].message.content;
        let hotels = [];
        
        try {
          // Try to parse JSON from response
          const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            hotels = JSON.parse(jsonMatch[0]);
          }
        } catch (parseError) {
          console.log('Failed to parse AI response, using mock data');
        }

        if (hotels && hotels.length > 0) {
          // Format AI response to match expected structure
          const formattedHotels = hotels.map((hotel, idx) => ({
            hotel_id: idx + 1,
            hotel_name: hotel.hotel_name || hotel.name,
            hotel_name_trans: hotel.hotel_name || hotel.name,
            address: hotel.address || `${cityName}`,
            review_score: hotel.rating || 4.5,
            review_score_word: hotel.rating >= 4.5 ? 'Excellent' : hotel.rating >= 4 ? 'Very Good' : 'Good',
            price_breakdown: {
              gross_price: (hotel.price_per_night || 100) * (Math.ceil((new Date(checkout_date) - new Date(checkin_date)) / (1000 * 60 * 60 * 24)) || 1) * adults_number,
              all_inclusive_price: (hotel.price_per_night || 100) * 1.1 * (Math.ceil((new Date(checkout_date) - new Date(checkin_date)) / (1000 * 60 * 60 * 24)) || 1) * adults_number
            },
            min_total_price: (hotel.price_per_night || 100) * (Math.ceil((new Date(checkout_date) - new Date(checkin_date)) / (1000 * 60 * 60 * 24)) || 1) * adults_number,
            main_photo_url: `https://picsum.photos/seed/hotel${cityName}${idx}/400/300`,
            distance_to_cc: (Math.random() * 5).toFixed(1),
            amenities: hotel.amenities || ['WiFi', 'Pool'],
            description: hotel.description || ''
          }));

          return res.json({ 
            success: true, 
            data: { 
              result: formattedHotels 
            } 
          });
        }
      } catch (openRouterError) {
        console.log('OpenRouter failed, using mock data:', openRouterError.message);
      }
    }

    // Fallback to mock data (always works, no API needed)
    const mockHotels = generateMockHotels(cityName, checkin_date, checkout_date, parseInt(adults_number) || 2);
    
    res.json({ 
      success: true, 
      data: { 
        result: mockHotels 
      } 
    });
  } catch (error) {
    console.error('Hotels search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hotels',
      error: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV ? error.message : undefined
    });
  }
});

// Hotels - Get locations (for finding destination IDs)
app.get('/api/hotels/locations', async (req, res) => {
  try {
    const { name, locale = 'en-us' } = req.query;
    
    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Location name is required' 
      });
    }

    const response = await axios.get('https://booking-com.p.rapidapi.com/v1/hotels/locations', {
      params: {
        name,
        locale
      },
      headers: {
        'x-rapidapi-host': 'booking-com.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      },
      timeout: 30000
    });

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('Hotels locations API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hotel locations',
      error: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV ? error.message : undefined
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



