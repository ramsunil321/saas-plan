// In your React component:

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import './login.css'; 

const Login = ({ userType }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (userType === 'user') {
        navigate('/user-dashboard');
      } else if (userType === 'admin') {
        navigate('/admin-dashboard');
      }

    } catch (error) {
      setError('Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-container${userType === 'admin' ? ' admin' : ''}`}>
      {userType !== 'admin' ? <h2>Login</h2> : <h2>Admin Login</h2>}
      <form className="login-form" onSubmit={handleAuth}>
        <label>Email:</label>
        <input type="email" className="login-input" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label>Password:</label>
        <input type="password" className="login-input" value={password} onChange={(e) => setPassword(e.target.value)} required />

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className="login-button" disabled={loading}>Login</button>
      </form>

      <p className="register-link">
        {userType !== 'admin' && (
          <span>
            New user? <Link to="/user-register">Register here</Link>
          </span>
        )}
      </p>

      {userType !== 'admin' && (
        <p className="admin-link">
          Are you an admin?{' '}
          <Link to="/admin-login">Click here to login as admin</Link>
        </p>
      )}
    </div>
  );
};

export default Login;
