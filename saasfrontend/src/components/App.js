import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Link } from "react-router-dom";
import Home from "./pages/Home";
import UserLogin from "./pages/UserLogin";
import AdminLogin from "./pages/AdminLogin";
import Register from './auth/Register';
import UserDashboard from './user/UserDashboard';
import Plans from './user/Plans';
import Cart from './user/Cart';
import Checkout from './user/Checkout';
import OrderHistory from './user/OrderHistory';

function App() {
  return (
    <div>
      <Router>
     
        
        <Routes>
          <Route path="/" exact element={<Home />} />
          <Route path="/user-login" exact element={<UserLogin />} />
          <Route path="/user-register" element={<Register userType="user" />} />
          <Route path="/admin-login" exact element={<AdminLogin />} />
          <Route path="/user-dashboard" element={<UserDashboard />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order-history" element={<OrderHistory />} />
        </Routes>
        
      </Router>
    </div>
  );
}

export default App;
