import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { writeBatch, doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db, auth } from "@/config";
import { onAuthStateChanged } from "firebase/auth";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { BrowserWallet } from "@meshsdk/core";

export default function FinalizeQuestPage() {
  const router = useRouter();
  const { id: questId } = router.query;

  const [loading, setLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [quest, setQuest] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [wallets, setWallets] = useState<{ id: string; name: string }[]>([]);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Fetch quest when ready
  useEffect(() => {
    if (questId && authReady) {
      const fetchQuest = async () => {
        try {
          const questRef = doc(db, "quests", questId as string);
          const questSnap = await getDoc(questRef);
          if (questSnap.exists()) {
            const questData = questSnap.data();
            setQuest(questData);
            // Log quest creator for debugging
            console.log("Quest creator UID:", questData.creatorUid);
          } else {
            setError("Quest not found");
          }
        } catch (err: any) {
          setError(err.message);
        }
      };
      fetchQuest();
    }
  }, [questId, authReady]);

  // Fetch available wallets on mount
  useEffect(() => {
    const fetchWallets = async () => {
      try {
        const availableWallets = await BrowserWallet.getAvailableWallets();
        setWallets(availableWallets);
        if (availableWallets.length === 0) {
          toast.warn("No Cardano wallets found. Please install a wallet like Nami or Eternl.");
        }
      } catch (error) {
        toast.error("Failed to fetch wallets.");
      }
    };
    fetchWallets();
  }, []);

  const handleWalletSelect = async (walletId: string) => {
    setShowWalletModal(false);
    try {
      const connectedWallet = await BrowserWallet.enable(walletId);
      setWallet(connectedWallet);
      const address = await connectedWallet.getChangeAddress();
      setWalletAddress(address);
      toast.success(`Wallet connected: ${address.slice(0, 10)}...${address.slice(-6)}`);
    } catch (error: any) {
      toast.error(`Failed to connect wallet: ${error.message || error}`);
    }
  };

  // Placeholder: implement your transaction building logic here
  const buildUnsignedTxs = async (
    allocations: { address: string; amount: number }[],
    wallet: BrowserWallet
  ): Promise<string[]> => {
    // TODO: Use Mesh SDK to build unsigned transactions for allocations
    // This is an example stub returning empty array for demonstration
    return [];
  };

  const handleFinalize = async () => {
    if (!user) {
      toast.error("Please sign in to finalize the quest");
      return;
    }
    if (!questId) {
      toast.error("Quest ID not found");
      return;
    }
    if (!wallet) {
      toast.error("Please connect a wallet");
      return;
    }

    setLoading(true);
    try {
      // 1. Fetch participants' progress from Firestore
      const participantsRef = collection(db, "questProgress", questId as string, "participants");
      const participantsSnapshot = await getDocs(participantsRef);

      if (participantsSnapshot.empty) {
        toast.error("No participants found for this quest");
        setLoading(false);
        return;
      }

      // 2. Calculate allocations (example: fixed 100 tokens)
      const allocations = participantsSnapshot.docs.map((doc) => ({
        address: doc.data().address as string,
        amount: 100, // replace with your reward logic
        participantDocId: doc.id,
      }));

      // 3. Build unsigned transactions (your existing logic)
      const unsignedTxs = await buildUnsignedTxs(allocations, wallet);

      if (!unsignedTxs || !Array.isArray(unsignedTxs) || unsignedTxs.length === 0) {
        throw new Error("No unsigned transactions generated");
      }

      // 4. Sign each transaction
      const signedTxs: string[] = [];
      for (const unsignedTx of unsignedTxs) {
        const signedTx = await wallet.signTx(unsignedTx);
        signedTxs.push(signedTx);
      }

      // 5. Write eligibility and update quest status in Firestore using batch
      const batch = writeBatch(db);

      // Mark each participant as eligible (or rewarded) and store signedTx (optional)
      allocations.forEach(({ participantDocId, amount }, idx) => {
        const participantDocRef = doc(db, "questProgress", questId as string, "participants", participantDocId);
        batch.update(participantDocRef, {
          status: "rewarded",
          rewardAmount: amount,
          signedTx: signedTxs[idx],
          rewardedAt: new Date().toISOString(),
        });
      });

      // Also update quest status to "ended"
      const questDocRef = doc(db, "quests", questId as string);
      batch.update(questDocRef, {
        status: "ended",
        endedAt: new Date().toISOString(),
      });

      // Commit all batched writes atomically
      await batch.commit();

      toast.success("Quest finalized successfully!");
      router.push(`/quest/${questId}`);
    } catch (error: any) {
      toast.error(`Failed to finalize quest: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  if (!authReady || !quest) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center mt-20">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center mt-20 text-red-600">{error}</div>
      </div>
    );
  }

  const isCreator = user && quest.creatorUid === user.uid;
  const isAlreadyFinalized = quest.status === "ended";

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="bg-white w-full max-w-md shadow-2xl p-8 rounded-lg">
        <h1 className="text-2xl font-bold mb-4">Finalize Quest: {quest.name}</h1>

        {isAlreadyFinalized ? (
          <p className="text-green-600">This quest has already been finalized.</p>
        ) : !isCreator ? (
          <p className="text-red-600">Only the quest creator can finalize this quest.</p>
        ) : (
          <>
            <p className="mb-4">
              Finalize the quest to allocate rewards based on user progress. This will require signing
              transactions with your wallet.
            </p>

            {!wallet ? (
              <>
                <button
                  className="btn w-full bg-blue-600 text-white hover:bg-blue-700 mb-4"
                  onClick={() => setShowWalletModal(true)}
                >
                  Connect Wallet
                </button>

                {/* Wallet selection modal */}
                {showWalletModal && (
                  <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center">
                    <div className="bg-white p-6 rounded-lg shadow-xl text-center space-y-4 max-w-md w-full">
                      <h2 className="text-xl font-bold">Select a Wallet</h2>
                      {wallets.length === 0 && (
                        <p className="text-sm text-red-600">
                          No wallets found. Please install a Cardano wallet extension.
                        </p>
                      )}
                      {wallets.map((w) => (
                        <button
                          key={w.id}
                          onClick={() => handleWalletSelect(w.id)}
                          className="btn w-full my-2"
                        >
                          {w.name}
                        </button>
                      ))}
                      <button
                        onClick={() => setShowWalletModal(false)}
                        className="btn btn-ghost mt-4"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="mb-4">
                Connected wallet:{" "}
                <span className="font-mono">
                  {walletAddress?.slice(0, 10)}...{walletAddress?.slice(-6)}
                </span>
              </p>
            )}

            <button
              className="btn w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={handleFinalize}
              disabled={loading || !wallet}
            >
              {loading ? "Finalizing..." : "Finalize Quest"}
            </button>
          </>
        )}

        <ToastContainer position="bottom-right" autoClose={3000} />
      </div>
    </div>
  );
}
