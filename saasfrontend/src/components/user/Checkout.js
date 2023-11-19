import React, { useState } from 'react';

const Checkout = ({ cart, handleCheckout }) => {
  const [shippingDetails, setShippingDetails] = useState({ name: '', address: '' });

  const handleInputChange = (e) => {
    setShippingDetails({ ...shippingDetails, [e.target.name]: e.target.value });
  };

  return (
    <div>
      <h2>Checkout</h2>
      <form>
        <label>Name:</label>
        <input type="text" name="name" value={shippingDetails.name} onChange={handleInputChange} required />

        <label>Address:</label>
        <textarea name="address" value={shippingDetails.address} onChange={handleInputChange} required />

        <button type="button" onClick={() => handleCheckout(shippingDetails, cart)}>Place Order</button>
      </form>
    </div>
  );
};

export default Checkout;
