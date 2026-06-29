const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");

// Routes for User Management
router.post(
  "/register",
  authMiddleware.isAuthenticated,
  authMiddleware.isAdmin,
  userController.registerUser
);
router.post("/login", userController.loginUser);
router.get(
  "/users",
  authMiddleware.isAuthenticated,
  authMiddleware.isAdmin,
  userController.getAllUsers
);

module.exports = router;
