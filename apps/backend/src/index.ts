import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config';
import { z as zod } from 'zod';
import cors from 'cors';
import { PrismaClient } from '../../../common/db/node_modules/.prisma/client';
import multer from 'multer';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from 'dotenv';
import { NodeHttpHandler } from "@aws-sdk/node-http-handler";
dotenv.config();
// Initialize Prisma Client
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// Test database connection
async function testConnection() {
  try {
    await prisma.$connect();
    console.log('Successfully connected to database');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }
}

testConnection();

const app = express();
const port = process.env.PORT || 3002;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });
const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || ""
  },
  forcePathStyle: true,  // Required for R2
  tls: true,  // Force HTTPS
  // Custom DNS settings (Node 16+)
  requestHandler: { // Provide options directly
    connectionTimeout: 5000,
    socketTimeout: 5000
  }
});
const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || "";
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL || "https://pub-3f302ea423334407b3183fceb59dece7.r2.dev";

// Types
interface AuthRequest extends Request {
  user?: {
    userId: string;
  };
  file?: Express.Multer.File;
}

// Middleware
const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      console.error('Token verification error:', err);
      res.status(403).json({ message: 'Invalid or expired token' });
      return;
    }
    req.user = { userId: user.userId };
    next();
  });
};

// Validation schemas
const signupSchema = zod.object({
  name: zod.string().min(3),
  email: zod.string().email(),
  password: zod.string()
});

const signinSchema = zod.object({
  email: zod.string().email(),
  password: zod.string()
});

const demoSchema = zod.object({
  title: zod.string().min(1),
  description: zod.string(),
  type: zod.string(),
  content: zod.string(),
  thumbnail: zod.string().optional(),
  url: zod.string().optional(),
  isPublic: zod.boolean().optional().default(false),
});

// Auth Routes
app.post('/api/auth/signup', async (req: Request, res: Response) => {
  try {
    const { success } = signupSchema.safeParse(req.body);
    if (!success) {
      return res.status(411).json({
        message: "Invalid input data"
      });
    }

    const { name, email, password, confirmPassword } = req.body;
    
    if (password !== confirmPassword) {
      return res.status(411).json({
        message: "Passwords do not match"
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(411).json({
        message: "Email already taken"
      });
    }

    const user = await prisma.user.create({
      data: {
        email,
        password,
        name
      }
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    return res.json({
      message: "User created successfully",
      token
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    console.log('Login attempt with body:', req.body);
    
    const result = signinSchema.safeParse(req.body);
    if (!result.success) {
      console.log('Validation failed:', result.error);
      return res.status(400).json({
        message: "Invalid email or password format"
      });
    }

    const { email, password } = result.data;
    console.log('Looking up user with email:', email);

    try {
      // Find user by email first
      const user = await prisma.user.findUnique({
        where: { 
          email: email
        },
        select: {
          id: true,
          email: true,
          password: true
        }
      });

      console.log('User lookup result:', user ? 'Found' : 'Not found');

      // If no user found or password doesn't match
      if (!user || user.password !== password) {
        console.log('Authentication failed:', !user ? 'No user found' : 'Password mismatch');
        return res.status(401).json({
          message: "Invalid email or password"
        });
      }

      // Generate token
      const token = jwt.sign({ userId: user.id }, JWT_SECRET);
      console.log('Login successful, token generated for user:', user.id);
      
      return res.json({ token });
    } catch (dbError) {
      console.error('Database error:', dbError);
      throw dbError;
    }
  } catch (error: any) {
    console.error('Login error details:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    });
    return res.status(500).json({
      message: "Internal server error",
      details: error?.message || "Unknown error occurred"
    });
  }
});

app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    return res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
});

// Demo Routes
app.post('/api/demos', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const { success } = demoSchema.safeParse(req.body);
    if (!success) {
      return res.status(400).json({ message: "Invalid demo data" });
    }

    const { title, description, type, content, thumbnail, url, isPublic } = req.body;
    const demo = await prisma.demo.create({
      data: {
        title,
        description,
        type,
        content,
        thumbnail,
        url,
        isPublic,
        views: 0,
        user: {
          connect: {
            id: req.user.userId
          }
        }
      }
    });

    return res.status(201).json(demo);
  } catch (error) {
    console.error('Create demo error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.get('/api/demos', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const demos = await prisma.demo.findMany({
      where: {
        user: {
          id: req.user.userId
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json(demos);
  } catch (error) {
    console.error('Get demos error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.get('/api/demos/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const { id } = req.params;
    const demo = await prisma.demo.findFirst({
      where: {
        id,
        user: {
          id: req.user.userId
        }
      }
    });

    if (!demo) {
      return res.status(404).json({ message: "Demo not found" });
    }

    // Increment views
    await prisma.demo.update({
      where: { id },
      data: { views: { increment: 1 } }
    });

    return res.json(demo);
  } catch (error) {
    console.error('Get demo error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.put('/api/demos/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const { id } = req.params;
    const { success } = demoSchema.safeParse(req.body);
    if (!success) {
      return res.status(400).json({ message: "Invalid demo data" });
    }

    const demo = await prisma.demo.findFirst({
      where: {
        id,
        user: {
          id: req.user.userId
        }
      }
    });

    if (!demo) {
      return res.status(404).json({ message: "Demo not found" });
    }

    const { title, description, type, content, thumbnail, url, isPublic } = req.body;
    const updatedDemo = await prisma.demo.update({
      where: { id },
      data: {
        title,
        description,
        type,
        content,
        thumbnail,
        url,
        isPublic,
      }
    });

    return res.json(updatedDemo);
  } catch (error) {
    console.error('Update demo error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.delete('/api/demos/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const { id } = req.params;
    const demo = await prisma.demo.findFirst({
      where: {
        id,
        user: {
          id: req.user.userId
        }
      }
    });

    if (!demo) {
      return res.status(404).json({ message: "Demo not found" });
    }

    await prisma.demo.delete({
      where: { id }
    });

    return res.json({ message: "Demo deleted successfully" });
  } catch (error) {
    console.error('Delete demo error:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Image Upload Endpoint (Fixed)
app.post('/api/upload-image', authenticateToken, upload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    if (!R2_BUCKET_NAME) {
      return res.status(500).json({ message: "R2 bucket name not configured" });
    }

    const file = req.file;
    const key = `uploads/${Date.now()}-${file.originalname}`;

    console.log("Preparing upload:", {
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      bufferLength: file.buffer.length,
      bucket: R2_BUCKET_NAME
    });

    const params = {
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    try {
      const command = new PutObjectCommand(params);
      await r2Client.send(command);
    } catch (uploadErr: any) {
      console.error("❌ R2 Upload Failed:", uploadErr.message);
      return res.status(500).json({ 
        message: "Upload to R2 failed", 
        error: uploadErr.message,
        details: {
          bucket: R2_BUCKET_NAME,
          endpoint: process.env.CLOUDFLARE_R2_ENDPOINT
        }
      });
    }

    const imageUrl = `${R2_PUBLIC_URL}/${key}`;
    console.log('✅ Image uploaded to R2:', imageUrl);

    return res.json({ url: imageUrl });

  } catch (error: any) {
    console.error('❌ Image upload error:', error.message, error.stack);
    return res.status(500).json({ 
      message: "Internal server error", 
      error: error.message 
    });
  }
});

// Test endpoint
app.get('/api/test', (_req: Request, res: Response) => {
  res.json({ message: 'API is working!' });
});
app.get('/api/debug-env', (_req, res) => {
  res.json({
    bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
    endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
    publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL
  });
});
// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});