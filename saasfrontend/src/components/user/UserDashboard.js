import React from 'react';
import { Link } from 'react-router-dom';


const Dashboard = () => {
  return (
    <div>
      <h2>User Dashboard</h2>
      <p>Welcome to your dashboard! Here, you can manage your account and view your orders.</p>
      <nav>
        <ul>
          <li><Link to="/user/plans">Browse Plans</Link></li>
          <li><Link to="/user/cart">Shopping Cart</Link></li>
          <li><Link to="/user/checkout">Checkout</Link></li>
          <li><Link to="/user/order-history">Order History</Link></li>
        </ul>
      </nav>
    </div>
  );
};

export default Dashboard;
