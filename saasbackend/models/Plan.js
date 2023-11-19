const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  expirationDate: { type: Date, required: true },
  paymentIntentId: { type: String },  
  paymentStatus: { type: String },    
});

const Plan = mongoose.model('Plan', planSchema);

module.exports = Plan; 
