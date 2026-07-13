import Razorpay from 'razorpay';

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

export async function inspectRazorpayOrder(orderId: string, expectedAmountPaise: number) {
  const [order, paymentsResult] = await Promise.all([
    razorpay.orders.fetch(orderId),
    razorpay.orders.fetchPayments(orderId),
  ]);
  const payments = paymentsResult.items ?? [];
  const capturedPayments = payments.filter(
    (payment) => payment.captured === true && payment.status === 'captured',
  );
  const exactCapturedPayment = capturedPayments.find(
    (payment) =>
      payment.order_id === orderId &&
      Number(payment.amount) === expectedAmountPaise &&
      payment.currency === 'INR',
  );
  const hasAuthorizedPayment = payments.some((payment) => payment.status === 'authorized');
  const onlyTerminalUnpaidPayments =
    payments.length > 0 &&
    payments.every((payment) => payment.status === 'failed' || payment.status === 'refunded');
  const orderMatches = Number(order.amount) === expectedAmountPaise && order.currency === 'INR';

  return {
    orderStatus: order.status,
    orderMatches,
    exactCapturedPayment,
    hasCapturedPayment: capturedPayments.length > 0,
    hasAuthorizedPayment,
    canSafelyExpire:
      orderMatches &&
      capturedPayments.length === 0 &&
      !hasAuthorizedPayment &&
      (order.status === 'created' || onlyTerminalUnpaidPayments),
  };
}
