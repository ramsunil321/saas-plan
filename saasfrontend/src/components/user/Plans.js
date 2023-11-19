import React from 'react';
import { PricingTable, PricingSlot, PricingDetail } from 'react-pricing-table';

const Plans = ({ handleSubscription }) => {
  const customPricingTable = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh'
  };

  const pricingSlotStyle = {
    borderRight: '2px solid #ddd', 
  };

  return (
    <div style={customPricingTable}>
      <PricingTable highlightColor='#1976D2'>
        <PricingSlot style={pricingSlotStyle} onClick={() => handleSubscription('Free')} buttonText='TRY IT FREE' title='Basic' priceText='Free for 14 Days'>
          <PricingDetail> Limited to 1 user</PricingDetail>
        </PricingSlot>

        <PricingSlot style={pricingSlotStyle} onClick={() => handleSubscription('Standard')} buttonText='SIGN UP' title='Standard' priceText='INR 4999 Per Year, Per User'>
          <PricingDetail> Up to 5 users</PricingDetail>
        </PricingSlot>

        <PricingSlot style={pricingSlotStyle} onClick={() => handleSubscription('Plus')} buttonText='SIGN UP' title='Plus' priceText='INR 3999 Per Year, Per User above 10 users'>
          <PricingDetail> Above 10 users</PricingDetail>
        </PricingSlot>
      </PricingTable>
    </div>
  );
};

export default Plans;
