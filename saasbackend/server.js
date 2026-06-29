const express = require('express');
const mongoose = require('mongoose');
const config = require('./config/config');
const planRoutes = require('./routes/planRoutes');
const userRoutes = require('./routes/userRoutes');
// const authRoutes = require('./routes/authRoutes');

const app = express();

// Middleware
app.use(express.json());

// Connect to MongoDB
mongoose.connect(config.mongodbUri, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;

db.on('error', (error) => console.error(error));
db.once('open', () => console.log('Connected to database'));

// Routes
app.use('/api', planRoutes);
app.use('/api', userRoutes);
// app.use('/api', authRoutes);

// Start the server
app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});
