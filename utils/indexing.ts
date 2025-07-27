import axios from 'axios';

const BLOCKFROST_API_KEY = process.env.NEXT_PUBLIC_BLOCKFROST_KEY;

if (!BLOCKFROST_API_KEY) {
  throw new Error('NEXT_PUBLIC_BLOCKFROST_KEY is not defined in environment variables');
}

const BASE_URL = 'https://cardano-mainnet.blockfrost.io/api/v0';
const HEADERS = { project_id: BLOCKFROST_API_KEY };

interface AssetOwner {
  asset: string;
  policy_id: string;
  asset_name: string;
  fingerprint: string;
}

interface AssetInfo {
  policyId: string;
  assetName: string;
  quantity: string;
  address: string;
  asset: string;
  policy_id: string;
  asset_name: string;
  fingerprint: string;
}

async function getAssetOwner(assetUnit: string): Promise<AssetOwner | null> {
  try {
    const res = await axios.get(`${BASE_URL}/assets/${assetUnit}`, {
      headers: HEADERS,
    });

    return {
      asset: assetUnit,
      policy_id: res.data.policy_id,
      asset_name: res.data.asset_name,
      fingerprint: res.data.fingerprint,
    };
  } catch (err: any) {
    console.error('Error fetching asset owner:', err.message);
    return null;
  }
}

async function getAssetInfoFromTx(txHash: string): Promise<AssetInfo[] | null> {
  try {
    const { data: utxos } = await axios.get(`${BASE_URL}/txs/${txHash}/utxos`, {
      headers: HEADERS,
    });

    const results: AssetInfo[] = [];

    for (const output of utxos.outputs) {
      for (const asset of output.amount) {
        if (asset.unit !== 'lovelace') {
          const policyId = asset.unit.slice(0, 56);
          const assetNameHex = asset.unit.slice(56);
          let assetName: string;

          try {
            assetName = Buffer.from(assetNameHex, 'hex').toString();
          } catch {
            assetName = assetNameHex;
          }

          const assetUnit = `${policyId}${assetNameHex}`;
          const owner = await getAssetOwner(assetUnit);

          if (owner) {
            results.push({
              policyId,
              assetName,
              quantity: asset.quantity,
              address: output.address,
              ...owner,
            });
          }
        }
      }
    }

    return results;
  } catch (err: any) {
    console.error('Error fetching asset info:', err.message);
    return null;
  }
}

export { getAssetOwner, getAssetInfoFromTx };