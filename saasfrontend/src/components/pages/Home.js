import React from 'react';
import { Link } from 'react-router-dom';
import './Home.css'; // Import a CSS file for styling

const Home = () => {
  const plans = [
    { name: 'Basic', description: 'Free for 14 Days. Limited to 1 user' },
    { name: 'Standard', description: 'INR 4999 Per Year, Per User, up to 5 users' },
    { name: 'Plus', description: 'INR 3999 Per Year, Per User above 10 users' },
  ];

  return (
    <div className="home-container">
      <nav className="navbar">
        <h1>Subscription System</h1>
        <Link to="/user-login" className="nav-link">Login</Link>
        <Link to="/user-register" className="nav-link">Register</Link>
      </nav>

      <div className="plans-container">
        <h2>Available Plans</h2>
        <ul className="plans-list">
          {plans.map((plan, index) => (
            <li key={index} className="plan-item">
              <strong className="plan-name">{plan.name} :</strong> <span className="plan-description">{plan.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Home;
