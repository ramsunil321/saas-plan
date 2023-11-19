const User = require('../models/User');
const jwt = require("jsonwebtoken")
const config = require("../config/config")

exports.registerUser = async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const newUser = new User({ username, password, role });
    const user = await newUser.save();
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user._id, role: user.role }, config.jwtSecret, {
      expiresIn: '1h',
    });

    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find();

    // Check plan validity for each user
    for (const user of users) {
      const plan = await Plan.findOne({ _id: user.planId });

      // Check if the plan is expired
      if (plan && plan.expirationDate < new Date()) {
        // Expire the plan or take appropriate action
        plan.status = 'expired';
        await plan.save();
      }
    }

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
