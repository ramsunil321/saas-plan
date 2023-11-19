const Plan = require("../models/Plan");
const config = require("../config/config");
const stripe = require("stripe")(config.stripeSecretKey);

exports.createPlan = async (req, res) => {
  try {
    const { name, description, price, durationMonths, paymentMethodId } =
      req.body;

    // Create a PaymentIntent with Stripe to verify payment
    const paymentIntent = await stripe.paymentIntents.create({
      amount: price * 100, // Convert price to cents
      currency: "usd",
      payment_method: paymentMethodId,
      confirmation_method: "automatic",
      confirm: true,
      return_url: "http://localhost:3000",
    });
    if (paymentIntent.status !== "succeeded") {
      // Handle other payment statuses if needed
      return res.status(400).json({ error: "Payment failed" });
    }

    if (paymentIntent.status === "requires_action") {
      // If additional authentication is required, send the client secret to handle it on the client side
      return res.status(200).json({
        requires_action: true,
        client_secret: paymentIntent.client_secret,
      });
    }

    // Calculate expiration date based on the current date and plan duration
    const expirationDate = new Date();
    expirationDate.setMonth(expirationDate.getMonth() + durationMonths);

    // Save the plan to the database
    const newPlan = new Plan({ name, description, price, expirationDate });
    const plan = await newPlan.save();

    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAllPlans = async (req, res) => {
  try {
    const plans = await Plan.find();
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPlanById = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const { name, description, price } = req.body;
    const plan = await Plan.findByIdAndUpdate(
      req.params.id,
      { name, description, price },
      { new: true }
    );
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    await Plan.findByIdAndDelete(req.params.id);
    res.json({ message: "Plan deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
