import { batchChoicesForProduct } from '../screens/PurchaseNewScreen';

describe('purchase batch flow', () => {
  it('includes zero-stock batches with expiry in the selection list', () => {
    const product: any = {
      id: 'p1',
      name: 'Vitamin C',
      sku: 'VIT',
      unit: 'bottle',
      trackBatches: true,
      batches: [
        { no: 'LOT-Z', expiry: '2027-01-01', qty: 0 },
        { no: 'LOT-B', expiry: '2027-02-02', qty: 12 },
      ],
    };

    const line: any = {
      productId: 'p1',
      qty: 4,
      batchAllocations: [{ batchNo: 'LOT-B', qty: 4, expiry: '2027-02-02' }],
    };

    const choices = batchChoicesForProduct(product, line);

    expect(choices.map((c) => c.no)).toEqual(expect.arrayContaining(['LOT-Z', 'LOT-B']));
    expect(choices.find((c) => c.no === 'LOT-Z')).toMatchObject({
      no: 'LOT-Z',
      qty: 0,
      expiry: '2027-01-01',
    });
  });
});
