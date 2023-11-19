// models/Plan.js

const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  expirationDate: { type: Date, required: true },
  paymentIntentId: { type: String },  // To store the Stripe Payment Intent ID
  paymentStatus: { type: String },    // To store the payment status (e.g., 'succeeded', 'failed')
});

const Plan = mongoose.model('Plan', planSchema);

module.exports = Plan;
