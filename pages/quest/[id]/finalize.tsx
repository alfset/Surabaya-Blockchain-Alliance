import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db, auth } from "@/config";
import { onAuthStateChanged } from "firebase/auth";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { BrowserWallet, Transaction, Asset } from "@meshsdk/core";

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
  const [participantsProgress, setParticipantsProgress] = useState<any[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [totalAllPoints, setTotalAllPoints] = useState(0);

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
            setQuest(questSnap.data());
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

  useEffect(() => {
    if (questId && quest) {
      const fetchParticipantsProgress = async () => {
        try {
          const participantsRef = collection(db, "quests", questId as string, "userProgress");
          const participantsSnapshot = await getDocs(participantsRef);
          const progressData: any[] = [];
          let totalPointsSum = 0;

          if (!participantsSnapshot.empty) {
            participantsSnapshot.docs.forEach((doc) => {
              const participantData = doc.data();
              const userId = doc.id;
              let totalPoints = 0;
              if (participantData.tasksCompleted && quest.tasks) {
                participantData.tasksCompleted.forEach((task: any) => {
                  const taskIndex = task.taskIndex;
                  if (taskIndex >= 0 && taskIndex < quest.tasks.length) {
                    const awardedPoints = task.awardedPoints || 0;
                    const taskPoints = quest.tasks[taskIndex]?.points || 0;
                    if (awardedPoints > 0) {
                      totalPoints += Math.min(awardedPoints, taskPoints);
                    }
                  }
                });
              }

              totalPointsSum += totalPoints;
              progressData.push({
                ...participantData,
                userId,
                totalPoints,
              });
            });

            const totalReward = quest.reward || 1;
            const rewardData = progressData.map((participant) => {
              const rewardEstimate =
                totalPointsSum > 0
                  ? (participant.totalPoints / totalPointsSum) * totalReward
                  : 0;
              return {
                ...participant,
                rewardEstimate: parseFloat(rewardEstimate.toFixed(6)),
              };
            });

            setParticipantsProgress(rewardData);
            setParticipantCount(participantsSnapshot.docs.length);
            setTotalAllPoints(totalPointsSum);
          } else {
            toast.warn("No participants found.");
            setParticipantCount(0);
            setTotalAllPoints(0);
          }
        } catch (error) {
          toast.error("Failed to fetch user progress.");
        }
      };
      fetchParticipantsProgress();
    }
  }, [questId, quest]);

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

  // Build transaction to deposit tokens into smart contract
  const buildUnsignedTxs = async (
    wallet: BrowserWallet,
    amount: number,
    policyId: string,
    tokenName: string,
    hostAddress: string,
    contractAddress: string
  ): Promise<string[]> => {
    try {
      const tx = new Transaction({ initiator: wallet });
      const asset: Asset = {
        unit: `${policyId}${tokenName}`,
        quantity: amount.toString(),
      };
      tx.sendAssets({ address: contractAddress }, [asset]);
      tx.setMetadata(0, { hostAddress });
      const unsignedTx = await tx.build();
      return [unsignedTx];
    } catch (error: any) {
      throw new Error(`Failed to build transaction: ${error.message || error}`);
    }
  };

  // Generate JSON/CSV for download
  const generateExportFile = (format: "json" | "csv") => {
    const exportData = participantsProgress
      .filter((p) => p.rewardEstimate > 0)
      .map((p) => ({
        userId: p.userId,
        walletAddress: p.walletAddress || "N/A",
        totalPoints: p.totalPoints,
        rewardAmount: p.rewardEstimate,
      }));

    if (format === "json") {
      const jsonData = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonData], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quest_${questId}_rewards.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = ["userId", "walletAddress", "totalPoints", "rewardAmount"];
      const csvRows = [
        headers.join(","),
        ...exportData.map((row) =>
          headers.map((header) => `"${row[header]}"`).join(",")
        ),
      ];
      const csvData = csvRows.join("\n");
      const blob = new Blob([csvData], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quest_${questId}_rewards.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
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
    if (!wallet || !walletAddress) {
      toast.error("Please connect a wallet");
      return;
    }
    if (!quest || user.uid !== quest.creatorUid) {
      toast.error("Only the quest creator can finalize this quest");
      return;
    }

    const deadline = new Date(quest.deadline).getTime();
    const now = new Date("2025-07-25T15:52:00Z").getTime();
    if (now > deadline) {
      toast.error("Quest deadline has passed. Cannot finalize.");
      return;
    }

    setLoading(true);
    try {
      const amount = quest.reward || 1;
      const policyId = quest.tokenPolicyId || "1";
      const tokenName = quest.tokenName || "1";
      const contractAddress = quest.scriptAddress || "";

      if (!amount || !policyId || !tokenName || !contractAddress) {
        throw new Error("Invalid quest configuration");
      }

      generateExportFile("json");
      toast.success("Reward allocation file generated for smart contract airdrop!");
      const unsignedTxs = await buildUnsignedTxs(
        wallet,
        amount,
        policyId,
        tokenName,
        walletAddress,
        contractAddress
      );
      if (!unsignedTxs || unsignedTxs.length === 0) {
        throw new Error("No unsigned transactions generated");
      }

      const signedTxs: string[] = [];
      for (const unsignedTx of unsignedTxs) {
        const signedTx = await wallet.signTx(unsignedTx);
        signedTxs.push(signedTx);
      }

      const txHash = await wallet.submitTx(signedTxs[0]);
      toast.success(`Transaction submitted: ${txHash.slice(0, 10)}...`);

      // Update quest status
      const questRef = doc(db, "quests", questId as string);
      await setDoc(questRef, {
        ...quest,
        status: "ended",
        endedAt: new Date().toISOString(),
        depositTxHash: txHash,
      });

      toast.success("Quest finalized and tokens deposited successfully!");
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
    <div className="min-h-screen bg-gray-100 flex items-center justify-center py-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="bg-white shadow-lg rounded-lg p-6">
          <h1 className="text-2xl font-bold mb-4 text-gray-800">Finalize Quest: {quest.name}</h1>

          {isAlreadyFinalized ? (
            <p className="text-green-600 font-medium">This quest has already been finalized.</p>
          ) : !isCreator ? (
            <p className="text-red-600 font-medium">Only the quest creator can finalize this quest.</p>
          ) : (
            <>
              <p className="mb-4 text-gray-600">
                Finalize the quest by depositing {quest.reward || 1} {quest.tokenName || "1"} (Policy ID: {quest.tokenPolicyId || "1"}) to the smart contract pool.
              </p>

              {!wallet ? (
                <>
                  <button
                    className="btn w-full bg-blue-600 text-white hover:bg-blue-700 rounded-md py-2 mb-4 transition duration-200"
                    onClick={() => setShowWalletModal(true)}
                  >
                    Connect Wallet
                  </button>

                  {showWalletModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center">
                      <div className="bg-white p-6 rounded-lg shadow-xl text-center space-y-4 max-w-md w-full">
                        <h2 className="text-xl font-bold text-gray-800">Select a Wallet</h2>
                        {wallets.length === 0 && (
                          <p className="text-sm text-red-600">
                            No wallets found. Please install a Cardano wallet extension.
                          </p>
                        )}
                        {wallets.map((w) => (
                          <button
                            key={w.id}
                            onClick={() => handleWalletSelect(w.id)}
                            className="btn w-full bg-blue-500 text-white hover:bg-blue-600 rounded-md py-2 transition duration-200"
                          >
                            {w.name}
                          </button>
                        ))}
                        <button
                          onClick={() => setShowWalletModal(false)}
                          className="btn w-full bg-gray-200 text-gray-800 hover:bg-gray-300 rounded-md py-2 transition duration-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="mb-4 text-gray-600">
                  Connected wallet:{" "}
                  <span className="font-mono text-sm text-gray-800">
                    {walletAddress?.slice(0, 10)}...{walletAddress?.slice(-6)}
                  </span>
                </p>
              )}

              <button
                className="btn w-full bg-blue-600 text-white hover:bg-blue-700 rounded-md py-2 disabled:opacity-50 transition duration-200"
                onClick={handleFinalize}
                disabled={loading || !wallet}
              >
                {loading ? "Finalizing..." : "Finalize Quest and Deposit Tokens"}
              </button>

              <div className="mt-4 flex space-x-4">
                <button
                  className="btn bg-green-500 text-gray-800 rounded-md py-2 px-4 hover:bg-green-600 text-white transition duration-200"
                  onClick={() => generateExportFile("json")}
                  disabled={participantsProgress.length === 0}
                >
                  Download JSON
                </button>
                <button
                  className="btn bg-blue-500 text-gray-800 rounded-md py-2 px-4 hover:bg-blue-600 text-white transition duration-200"
                  onClick={() => generateExportFile("csv")}
                  disabled={participantsProgress.length === 0}
                >
                  Download as CSV
                </button>
              </div>

              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-lg font-medium text-gray-800 mb-2">Summary</h3>
                <p className="text-sm text-gray-600">Total Participants: {participantCount}</p>
                <p className="text-sm text-gray-600">Total Points: {totalAllPoints}</p>
              </div>
            </>
          )}
        </div>

        <div class="bg-white shadow-lg rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4 mb-4 text-gray-800">Participants\' Progress</h2>
          <div className="max-h-[300px] overflow-y-auto border rounded-lg">
            {participantsProgress.length === 0 ? (
              <p className="p-4 text-gray-600">No progress found for participants.</p>
            ) : (
              <div className="grid grid-cols-4 gap-4 p-4 text-sm font-medium text-gray-700 bg-gray-50 border-b">
                <span>User ID</span>
                <span>Wallet Address</span>
                <span>Points</span>
                <span>Reward</span>
              </div>
            )}
            {participantsProgress.map((participant, index) => (
              <div
                key={index}
                className="grid grid-cols-4 gap-4 p-4 border-b border-gray-200 text-sm text-gray-600"
              >
                <span className="font-mono">{participant.userId.slice(0, 10)}...</span>
                <span className="font-mono">
                  {participant.walletAddress
                    ? `${participant.walletAddress.slice(0, 10)}...${participant.walletAddress.slice(-6)}`
                    : "N/A"}
                </span>
                <span>{participant.totalPoints} Points</span>
                <span>{participant.rewardEstimate} {quest.tokenName || "Tokens"}</span>
              </div>
            ))}
          </div>
        </div>

        <ToastContainer position="bottom-right" autoClose={3000} />
      </div>
    </div>
  );
}