import React from 'react';

const OrderHistory = ({ orderHistory }) => {
  return (
    <div>
      <h2>Order History</h2>
      {orderHistory.length === 0 ? (
        <p>No order history.</p>
      ) : (
        <ul>
          {orderHistory.map(order => (
            <li key={order.id}>
              <strong>{order.name}</strong>: {order.description} - {order.price} INR
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default OrderHistory;
