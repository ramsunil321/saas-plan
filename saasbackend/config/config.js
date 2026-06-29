require("dotenv").config()

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || "your_default_jwt_secret",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "your_stripe_secret_key",
  mongodbUri:
    process.env.MONGODB_URI || "mongodb://localhost:27017/saas-backend",
};