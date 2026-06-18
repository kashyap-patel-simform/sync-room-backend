import express from 'express';
import itemRoutes from './routes/itemRoutes';
import { errorHandler } from './middlewares/errorHandlers';

const app = express();

app.use(express.json());

// Routes
app.use('/api/items', itemRoutes);

// Global error handler (should be after routes)
app.use(errorHandler);

// Root route
app.get('/', (_, res) => {
  res.send('Welcome to the Item API');
});

export default app;
