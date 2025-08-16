import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import dotenv from 'dotenv';

import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { authMiddleware } from './middleware/auth';
import { requestLogger } from './middleware/requestLogger';

// Import routes
import authRoutes from './routes/auth';
import studentRoutes from './routes/students';
import courseRoutes from './routes/courses';
import instructorRoutes from './routes/instructors';
import adminRoutes from './routes/admin';
import analyticsRoutes from './routes/analytics';
import lmsRoutes from './routes/lms';
import aiRoutes from './routes/ai';
import notificationRoutes from './routes/notifications';

// Load environment variables
dotenv.config();

// Initialize Express app and HTTP server
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Initialize Prisma client
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

// Trust proxy for accurate client IP addresses
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'", "'unsafe-eval'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// Compression for better performance
app.use(compression());

// CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:5173',
      'https://edutrack-complete.vercel.app',
      'https://edutrack-complete.netlify.app',
      // Add production domains here
    ];

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key']
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // Limit requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and internal requests
    return req.path === '/health' || req.path === '/api/health';
  }
});

app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use(requestLogger);

// Swagger API documentation
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EduTrack Complete API',
      version: '1.0.0',
      description: 'Comprehensive Student & Course Management Platform with LMS, AI, and Advanced Analytics',
      contact: {
        name: 'EduTrack Support',
        email: 'support@edutrack.dev',
        url: 'https://edutrack.dev'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? process.env.API_URL || 'https://edutrack-api.onrender.com'
          : `http://localhost:${process.env.PORT || 3000}`,
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            error: { type: 'string' },
            details: { type: 'object' }
          }
        }
      }
    },
    tags: [
      { name: 'Authentication', description: 'User authentication and authorization' },
      { name: 'Students', description: 'Student management operations' },
      { name: 'Courses', description: 'Course management operations' },
      { name: 'Instructors', description: 'Instructor management operations' },
      { name: 'LMS', description: 'Learning Management System features' },
      { name: 'Analytics', description: 'Advanced analytics and reporting' },
      { name: 'AI', description: 'Artificial Intelligence features' },
      { name: 'Notifications', description: 'Notification management' },
      { name: 'Admin', description: 'Administrative operations' }
    ]
  },
  apis: ['./src/routes/*.ts', './src/controllers/*.ts']
};

const specs = swaggerJsdoc(swaggerOptions);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs, {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { color: #1f2937; }
    .swagger-ui .scheme-container { background: #f9fafb; }
  `,
  customSiteTitle: 'EduTrack Complete API Documentation',
  customfavIcon: '/favicon.ico'
}));

// Serve API specification as JSON
app.get('/api/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;

    const healthData = {
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: {
        status: 'connected',
        responseTime: Date.now() // This would be measured properly in production
      },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100,
        percentage: Math.round(process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100)
      },
      features: {
        ai_enabled: true,
        analytics_enabled: true,
        lms_enabled: true,
        realtime_enabled: true
      }
    };

    res.status(200).json({
      success: true,
      data: healthData
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      message: 'Service temporarily unavailable',
      timestamp: new Date()
    });
  }
});

// API information endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to EduTrack Complete API',
    description: 'Comprehensive Student & Course Management Platform with LMS, AI, and Advanced Analytics',
    version: '1.0.0',
    documentation: '/api/docs',
    health: '/health',
    features: [
      'Student & Course Management',
      'Learning Management System (LMS)',
      'AI-Powered Recommendations',
      'Advanced Analytics & Reporting',
      'Real-time Notifications',
      'Role-based Authentication',
      'Data Export & Import',
      'Comprehensive Audit Logging',
      'RESTful API Design'
    ],
    endpoints: {
      auth: '/api/auth',
      students: '/api/students',
      courses: '/api/courses',
      instructors: '/api/instructors',
      lms: '/api/lms',
      analytics: '/api/analytics',
      ai: '/api/ai',
      notifications: '/api/notifications',
      admin: '/api/admin'
    },
    support: {
      documentation: '/api/docs',
      email: 'support@edutrack.dev',
      github: 'https://github.com/edutrack/complete'
    }
  });
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/students', authMiddleware, studentRoutes);
app.use('/api/courses', authMiddleware, courseRoutes);
app.use('/api/instructors', authMiddleware, instructorRoutes);
app.use('/api/lms', authMiddleware, lmsRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint ${req.originalUrl} not found`,
    availableEndpoints: [
      '/api/auth',
      '/api/students',
      '/api/courses',
      '/api/instructors',
      '/api/lms',
      '/api/analytics',
      '/api/ai',
      '/api/notifications',
      '/api/admin',
      '/api/docs'
    ],
    suggestion: 'Check the API documentation at /api/docs for available endpoints'
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('public'));
  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'public' });
  });
}

// Global error handler
app.use(errorHandler);

// Socket.IO for real-time features
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('join-course', (courseId) => {
    socket.join(`course-${courseId}`);
    logger.info(`Client ${socket.id} joined course ${courseId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Make io available globally for other modules
app.set('io', io);

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed.');

    try {
      await prisma.$disconnect();
      logger.info('Database connection closed.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info('🚀'.repeat(50));
  logger.info(`🚀 EduTrack Complete API Server`);
  logger.info(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🚀 Port: ${PORT}`);
  logger.info(`🚀 API Base: http://localhost:${PORT}/api`);
  logger.info(`🚀 Documentation: http://localhost:${PORT}/api/docs`);
  logger.info(`🚀 Health Check: http://localhost:${PORT}/health`);
  logger.info(`🚀 Features: LMS, AI, Analytics, Real-time`);
  logger.info('🚀'.repeat(50));
});

export default app;