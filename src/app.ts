import express from 'express';
import { errorHandler } from './middlewares/errorHandlers';
import roomRoutes from './routes/roomRoutes';
import cors from 'cors';

const app = express();

app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL }));

// Routes
app.use('/api/room', roomRoutes);

// Global error handler (should be after routes)
app.use(errorHandler);

export default app;
