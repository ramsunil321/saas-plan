

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import './register.css'; 

const Register = ({ userType }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);

    if (password !== confirmPassword) {
      setLoading(false);
      setError('Password and Confirm Password do not match.');
      return;
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      navigate('/user-login');
    } catch (error) {
      setError('Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-container">
      <h2>Register</h2>
      <form className="register-form" onSubmit={handleRegister}>
        <label>Email:</label>
        <input type="email" className="register-input" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label>Password:</label>
        <input type="password" className="register-input" value={password} onChange={(e) => setPassword(e.target.value)} required />

        <label>Confirm Password:</label>
        <input type="password" className="register-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />

        {error && <p className="error-message">{error}</p>}
        <button type="submit" className="register-button" disabled={loading}>Register</button>
      </form>

      <p className="login-link">
        Already have an account? <Link to="/user-login">Login here</Link>
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

export default Register;
