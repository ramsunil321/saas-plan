const express = require("express");
const router = express.Router();
const planController = require("../controllers/planController");
const authMiddleware = require("../middleware/authMiddleware");

// Routes for SaaS Plan Management
router.post(
  "/plan",
  authMiddleware.isAuthenticated,
  authMiddleware.isAdmin,
  planController.createPlan
);
router.get(
  "/plans",
  authMiddleware.isAuthenticated,
  planController.getAllPlans
);
router.get(
  "/plan/:id",
  authMiddleware.isAuthenticated,
  planController.getPlanById
);
router.put(
  "/plan/:id",
  authMiddleware.isAuthenticated,
  authMiddleware.isAdmin,
  planController.updatePlan
);
router.delete(
  "/plan/:id",
  authMiddleware.isAuthenticated,
  authMiddleware.isAdmin,
  planController.deletePlan
);

module.exports = router;
