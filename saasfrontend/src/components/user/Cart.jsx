import React from 'react';

const Cart = ({ cart, removeFromCart, proceedToCheckout }) => {
  return (
    <div>
      <h2>Shopping Cart</h2>
      {cart.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <ul>
          {cart.map(item => (
            <li key={item.id}>
              <strong>{item.name}</strong>: {item.description} - {item.price} INR
              <button onClick={() => removeFromCart(item)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={proceedToCheckout} disabled={cart.length === 0}>Proceed to Checkout</button>
    </div>
  );
};

export default Cart;
