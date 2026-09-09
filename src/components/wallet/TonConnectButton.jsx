import { TonConnectButton as UiTonConnectButton, useTonWallet } from '@tonconnect/ui-react';

export default function TonConnectButton() {
  const wallet = useTonWallet();

  return (
    <div className="flex flex-col items-center gap-3">
      <UiTonConnectButton />
      {wallet ? (
        <p className="text-xs text-white/50 break-all text-center">
          Connected: {wallet.account.address}
        </p>
      ) : (
        <p className="text-xs text-white/50 text-center">
          Connect your TON wallet to redeem token &amp; NFT rewards.
        </p>
      )}
    </div>
  );
}
