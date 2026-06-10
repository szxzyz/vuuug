export interface PaymentSystem {
  id: string;
  name: string;
  icon: string;
  minWithdrawal: number;
  fee: number;
  feeType: 'fixed' | 'percentage';
  requiresStarPackage?: boolean;
}

export interface StarPackage {
  stars: number;
  usdCost: number;
}

export const STAR_PACKAGES: StarPackage[] = [];

export const DEFAULT_PAYMENT_SYSTEMS: PaymentSystem[] = [
  { id: 'TON', name: 'TON', icon: 'Gem', minWithdrawal: 0.5, fee: 5, feeType: 'percentage' }
];

export function getPaymentSystems(appSettings?: any): PaymentSystem[] {
  if (!appSettings) {
    return DEFAULT_PAYMENT_SYSTEMS;
  }
  
  return [
    { 
      id: 'TON', 
      name: 'TON', 
      icon: 'Gem', 
      minWithdrawal: appSettings.minimumWithdrawalTON ?? 0.5, 
      fee: appSettings.withdrawalFeeTON ?? 5, 
      feeType: 'percentage' 
    }
  ];
}

export const PAYMENT_SYSTEMS = DEFAULT_PAYMENT_SYSTEMS;

export const PAD_TO_USD_RATE = 10000000; // 10,000,000 PAD = $1
