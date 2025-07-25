import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import { doc, setDoc, getDoc, getDocs, collection } from "firebase/firestore";
import { db, auth } from "@/config";
import { onAuthStateChanged } from "firebase/auth";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Link from "next/link";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import LoadingScreen from "@/components/loading-screen";
import ErrorPage from "@/pages/error";
import { FaCalendarCheck, FaCheckCircle, FaCloudversify, FaDiscord, FaFirefoxBrowser, FaStopCircle } from "react-icons/fa";
import { BsArrowLeft } from "react-icons/bs";
import { FaXTwitter } from "react-icons/fa6";

interface Task {
  taskType: string;
  link: string;
  points: number;
}

interface UserProgress {
  tasksCompleted: { taskIndex: number; proof: string; awardedPoints: number; completedAt: string }[];
  pointsCollected: number;
  walletAddress: string;
  status: "pending" | "verified" | "rewarded";
}

interface Quest {
  id: string;
  name: string;
  description: string;
  tasks: Task[];
  reward: number;
  deadline: string;
  tokenPolicyId: string;
  tokenName: string;
  creatorWalletAddress: string;
  status: string;
}

interface UserData {
  twitterUsername?: string;
  discordUsername?: string;
  walletAddress?: string;
}

function extractTweetId(url: string): string | undefined {
  try {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return url.startsWith("http://") || url.startsWith("https://");
  } catch {
    return false;
  }
}

function isValidTwitterUsername(username: string): boolean {
  return /^[A-Za-z0-9_]{1,15}$/.test(username);
}

export default function DoQuestPage() {
  const [quest, setQuest] = useState<Quest | null>(null);
  const [userProgress, setUserProgress] = useState<UserProgress | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [totalPoints, setTotalPoints] = useState<number>(0);
  const [eligiblePoints, setEligiblePoints] = useState<number>(0);
  const [isQuestExpired, setIsQuestExpired] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log("Auth state changed:", !!user);
      setAuthReady(true);
      if (!user && authReady) {
        console.log("Redirecting to /signin");
        router.push({
          pathname: "/signin",
          query: { redirect: router.asPath },
        });
      }
    });
    return () => unsubscribe();
  }, [authReady, router]);

  const fetchQuestAndUserData = useCallback(async () => {
    if (!router.isReady || !id || typeof id !== "string" || !authReady || !auth.currentUser) {
      console.log("Fetch aborted: ", { isReady: router.isReady, id, authReady, user: !!auth.currentUser });
      if (!id || typeof id !== "string") setError("Invalid quest ID.");
      setLoading(false);
      return;
    }

    try {
      console.time("fetchQuestAndUserData");
      const [questDoc, userDoc, progressDoc, progressSnapshot] = await Promise.all([
        getDoc(doc(db, "quests", id)),
        getDoc(doc(db, "users", auth.currentUser.uid)),
        getDoc(doc(db, "quests", id, "userProgress", auth.currentUser.uid)),
        getDocs(collection(db, "quests", id, "userProgress")),
      ]);

      if (questDoc.exists()) {
        const questData = { id: questDoc.id, ...questDoc.data(), tasks: questDoc.data().tasks || [] } as Quest;
        setQuest(questData);

        const deadlineDate = new Date(questData.deadline);
        const currentDate = new Date();
        const isExpired = deadlineDate < currentDate || questData.status.toLowerCase() === "end";
        setIsQuestExpired(isExpired);
      } else {
        setError("Quest not found.");
        setLoading(false);
        return;
      }

      if (userDoc.exists()) {
        const data = userDoc.data();
        setUserData({
          twitterUsername: data.twitterUsername || "",
          discordUsername: data.discordUsername || "",
          walletAddress: data.walletAddress || "",
        });
      } else {
        setError("User data not found. Please complete your profile.");
        setLoading(false);
        return;
      }

      if (progressDoc.exists()) {
        setUserProgress(progressDoc.data() as UserProgress);
      } else {
        setUserProgress({
          tasksCompleted: [],
          pointsCollected: 0,
          walletAddress: userDoc.data()?.walletAddress || "",
          status: "pending",
        });
      }

      const total = progressSnapshot.docs.reduce((sum, doc) => {
        const data = doc.data() as UserProgress;
        return sum + (data.pointsCollected || 0);
      }, 0);
      setTotalPoints(total);

      console.timeEnd("fetchQuestAndUserData");
    } catch (error: any) {
      console.error("Error fetching data:", error);
      setError(`Failed to load data: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [router.isReady, id, authReady]);

  useEffect(() => {
    if (authReady && auth.currentUser) {
      fetchQuestAndUserData();
    }
  }, [fetchQuestAndUserData, authReady]);

  useEffect(() => {
    if (quest && userProgress && totalPoints > 0) {
      const userPoints = userProgress.pointsCollected || 0;
      const proportion = userPoints / totalPoints;
      const eligible = proportion * quest.reward;
      setEligiblePoints(Number(eligible.toFixed(2)));
    } else {
      setEligiblePoints(0);
    }
  }, [quest, userProgress, totalPoints]);

  const verifyTask = async (task: Task, taskIndex: number): Promise<{ verified: boolean; message: string; proof?: string }> => {
    if (!userData || !auth.currentUser) {
      return { verified: false, message: "User data or authentication missing." };
    }

    const { taskType, link } = task;
    const { twitterUsername, discordUsername, walletAddress } = userData;

    // Pre-validate user data
    if (["follow twitter", "retweet tweet", "like tweet"].includes(taskType.toLowerCase()) && !twitterUsername) {
      return { verified: false, message: "Please add your Twitter username in your profile." };
    }
    if (taskType.toLowerCase() === "join discord" && !discordUsername) {
      return { verified: false, message: "Please add your Discord username in your profile." };
    }
    if (["visit website", "check visit website"].includes(taskType.toLowerCase()) && !walletAddress) {
      return { verified: false, message: "Please connect your wallet in your profile." };
    }

    try {
      let body: any;
      let apiType: string;

      switch (taskType.toLowerCase()) {
        case "follow twitter":
          if (!isValidTwitterUsername(twitterUsername)) {
            return { verified: false, message: "Invalid Twitter username in your profile." };
          }
          if (!isValidTwitterUsername(link)) {
            return { verified: false, message: "Invalid Twitter username for this task." };
          }
          apiType = "follow twitter";
          body = {
            type: apiType,
            username: twitterUsername,
            target: link,
          };
          break;

        case "retweet tweet":
        case "like tweet":
          if (!isValidTwitterUsername(twitterUsername)) {
            return { verified: false, message: "Invalid Twitter username in your profile." };
          }
          const tweetId = extractTweetId(link);
          if (!tweetId) {
            return { verified: false, message: "Invalid tweet URL." };
          }
          apiType = taskType.toLowerCase() === "retweet tweet" ? "retweet" : "like";
          body = {
            type: apiType,
            username: twitterUsername,
            tweetId,
          };
          break;

        case "join discord":
          const [guildId, roleId] = link.split(":");
          if (!guildId || !roleId) {
            return { verified: false, message: "Invalid Discord guild or role ID." };
          }
          apiType = "join_discord";
          body = {
            type: apiType,
            discordUserId: discordUsername,
            guildId,
            roleId,
          };
          break;

        case "visit website":
        case "check visit website":
          if (!isValidUrl(link)) {
            return { verified: false, message: "Invalid website URL." };
          }
          apiType = taskType.toLowerCase() === "visit website" ? "visit_link" : "check_visit_link";
          body = {
            type: apiType,
            userId: auth.currentUser.uid,
            link,
          };
          break;

        default:
          return { verified: false, message: "Unsupported task type." };
      }

      console.time("verifyTask");
      const response = await fetch("/api/verify-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      console.timeEnd("verifyTask");

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }

      const result = await response.json();
      return {
        verified: result.verified,
        message: result.message,
        proof: result.data ? JSON.stringify(result.data) : link,
      };
    } catch (error: any) {
      console.error("Task verification error:", error);
      return {
        verified: false,
        message: error.message.includes("User not found")
          ? "Invalid Twitter or Discord username provided. Please update your profile."
          : `Task verification failed: ${error.message}`,
      };
    }
  };

  const handleTaskSubmit = async (taskIndex: number, task: Task) => {
    if (!quest || !auth.currentUser) {
      toast.error("Quest or user data missing.");
      return;
    }

    if (isQuestExpired) {
      toast.error("This quest has expired and cannot be completed.");
      return;
    }

    setSubmitting(true);
    try {
      const verificationResult = await verifyTask(task, taskIndex);
      toast[verificationResult.verified ? "success" : "error"](verificationResult.message);

      if (verificationResult.verified) {
        const currentProgress = userProgress || {
          tasksCompleted: [],
          pointsCollected: 0,
          walletAddress: userData?.walletAddress || "",
          status: "pending",
        };

        if (!currentProgress.tasksCompleted.some((t) => t.taskIndex === taskIndex)) {
          const newTaskCompletion = {
            taskIndex,
            proof: verificationResult.proof || task.link,
            awardedPoints: task.points,
            completedAt: new Date().toISOString(),
          };

          const updatedTasksCompleted = [...currentProgress.tasksCompleted, newTaskCompletion];
          const updatedPoints = currentProgress.pointsCollected + task.points;

          const updatedProgress: UserProgress = {
            ...currentProgress,
            tasksCompleted: updatedTasksCompleted,
            pointsCollected: updatedPoints,
          };

          await setDoc(
            doc(db, "quests", quest.id, "userProgress", auth.currentUser.uid),
            updatedProgress,
            { merge: true }
          );

          setUserProgress(updatedProgress);

          const progressSnapshot = await getDocs(collection(db, "quests", quest.id, "userProgress"));
          const total = progressSnapshot.docs.reduce((sum, doc) => {
            const data = doc.data() as UserProgress;
            return sum + (data.pointsCollected || 0);
          }, 0);
          setTotalPoints(total);
        } else {
          toast.info("Task already completed.");
        }
      }
    } catch (error: any) {
      console.error("Error submitting task:", error);
      toast.error(`Failed to submit task: ${error.message || error}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTaskRedirect = (task: Task) => {
    if (isQuestExpired) {
      toast.error("This quest has expired and cannot be accessed.");
      return;
    }

    const { taskType, link } = task;
    switch (taskType.toLowerCase()) {
      case "follow twitter":
        if (isValidTwitterUsername(link)) {
          window.open(`https://twitter.com/${link}`, "_blank");
        } else {
          toast.error("Invalid Twitter username for this task.");
        }
        break;
      case "visit website":
      case "check visit website":
        if (isValidUrl(link)) {
          window.open(link, "_blank");
        } else {
          toast.error("Invalid website URL.");
        }
        break;
      case "retweet tweet":
      case "like tweet":
        if (isValidUrl(link)) {
          window.open(link, "_blank");
        } else {
          toast.error("Invalid tweet URL.");
        }
        break;
      case "join discord":
        const [inviteCode] = link.split(":");
        if (inviteCode) {
          window.open(`https://discord.com/invite/${inviteCode}`, "_blank");
        } else {
          toast.error("Invalid Discord invite code.");
        }
        break;
      default:
        toast.error("Unsupported task type for redirect.");
    }
  };

  if (loading || !authReady) {
    console.log("Rendering loading state");
    return <LoadingScreen />;
  }

  if (error) {
    console.log("Rendering error state:", error);
    return <ErrorPage error={error} />;
  }

  if (!quest) {
    console.log("Rendering quest not found state");
    return <ErrorPage error="Quest not found!" />;
  }

  console.log("Rendering main content, quest:", quest);
  return (
    <section className="min-h-screen w-full bg-white text-black">
      <div className="flex justify-between items-center gap-4 px-40 py-10">
        {/* Quest Info */}
        <div className="flex items-center justify-start space-x-4">
          <div className="avatar">
            <div className="ring-gray-300 ring-offset-base-100 w-32 rounded-lg shadow-lg ring-2 ring-offset-2">
              <img
                src="/img/logo.png"
                alt="Quest avatar"
                onError={(e) => ((e.target as HTMLImageElement).src = "/img/logo.png")}
              />
            </div>
          </div>
          <div className="space-y-2 w-full text-start">
            <p className="font-semibold leading-none text-2xl">{quest.name}</p>
            <p className="text-sm break-words whitespace-normal">{quest.description}</p>
            <button className="btn btn-sm">
              <FaCalendarCheck />
              <span className="pt-1">{new Date(quest.deadline).toLocaleDateString()}</span>
              <div className={`badge badge-sm badge-${isQuestExpired ? "secondary" : "success"}`}>
                <span className="pt-1">{isQuestExpired ? "Expired" : "On Going"}</span>
              </div>
            </button>
          </div>
        </div>

        {/* Rewards */}
        <div className="card w-96 bg-base-100 shadow-sm border border-dashed border-gray-500">
          <div className="card-body">
            <span className="badge font-semibold badge-primary pt-1">Rewards</span>
            <div className="flex justify-between">
              <h2 className="text-3xl font-bold">{userProgress?.pointsCollected || 0}</h2>
              <span className="text-xl">🏆 Points</span>
            </div>
            <div className="py-1">
              <button
                className={`btn btn-${isQuestExpired ? "secondary cursor-not-allowed" : "success cursor-pointer"} btn-block`}
                disabled={isQuestExpired}
              >
                🏆 Claim <strong>{eligiblePoints} {quest.tokenName}</strong> Rewards
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="cursor-pointer w-full pb-10 overflow-hidden px-40">
        <Link href="/quests" className="card image-full h-auto rounded-xl">
          <img
            src="/img/bg-hero.svg"
            alt="Quests"
            className="w-full h-48 object-cover bg-opacity-10 rounded-2xl"
          />
          <div className="p-10 w-full text-end z-50 space-y-2 flex items-center justify-start">
            <div className="space-y-2">
              <span className="font-semibold text-4xl bg-gradient-to-r from-sky-400 to-indigo-600 bg-clip-text text-transparent break-words whitespace-nowrap">
                Rewards: <span className="text-white ml-2">{quest.reward} {quest.tokenName}</span>
              </span>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <p className="font-medium text-start text-gray-300">Eligible Reward</p>
                  <p className="font-medium text-start text-gray-300">
                    {userProgress?.pointsCollected || 0} / {totalPoints} Points
                  </p>
                </div>
                <progress
                  className="progress progress-info w-full bg-white"
                  value={userProgress?.pointsCollected || 0}
                  max={totalPoints}
                ></progress>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* Task List */}
      <div className="space-y-3 px-40">
        <h2 className="text-2xl font-semibold text-black">Your Task</h2>
        <div className="space-y-4">
          {quest.tasks && quest.tasks.length > 0 ? (
            quest.tasks.map((task, index) => {
              const isCompleted = userProgress?.tasksCompleted.some((t) => t.taskIndex === index);
              const isTwitterTask = ["follow twitter", "retweet tweet", "like tweet"].includes(
                task.taskType.toLowerCase()
              );
              const isDiscordTask = task.taskType.toLowerCase() === "join discord";
              const isVisitTask = ["visit website", "check visit website"].includes(
                task.taskType.toLowerCase()
              );
              const isDisabled =
                isQuestExpired ||
                isCompleted ||
                submitting ||
                (isTwitterTask && !userData?.twitterUsername) ||
                (isDiscordTask && !userData?.discordUsername) ||
                (isVisitTask && !userData?.walletAddress);

              let tooltipMessage = "";
              if (isQuestExpired) {
                tooltipMessage = "Quest has expired";
              } else if (isCompleted) {
                tooltipMessage = "Task already completed";
              } else if (isTwitterTask && !userData?.twitterUsername) {
                tooltipMessage = "Add your Twitter username in your profile";
              } else if (isDiscordTask && !userData?.discordUsername) {
                tooltipMessage = "Add your Discord username in your profile";
              } else if (isVisitTask && !userData?.walletAddress) {
                tooltipMessage = "Connect your wallet in your profile";
              } else {
                tooltipMessage = "Click to visit task link";
              }

              return (
                <div
                  key={index}
                  className={`flex justify-between w-full items-center bg-white text-black p-4 sm:p-5 rounded-xl border border-[#487eb0] hover:shadow-[0_4px_0px_0px_#487eb0] transition-shadow ${
                    isQuestExpired || isCompleted ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  }`}
                  onClick={() => !isQuestExpired && !isCompleted && handleTaskRedirect(task)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-white rounded-md flex items-center justify-center">
                      {isTwitterTask ? (
                        <FaXTwitter className="text-black" />
                      ) : isDiscordTask ? (
                        <FaDiscord className="text-indigo-600" />
                      ) : (
                        <FaFirefoxBrowser className="text-orange-400" />
                      )}
                    </div>
                    <p className="font-semibold text-xl sm:text-base pt-1">
                      {isTwitterTask
                        ? `Visit the Twitter account or tweet`
                        : isDiscordTask
                        ? `Join the Discord server`
                        : isVisitTask
                        ? `Visit the website`
                        : `Complete the task at: ${task.link}`}
                    </p>
                  </div>
                  <div className="flex gap-2 items-center justify-center">
                    <div className="flex items-center gap-2 border bg-transparent border-[#487eb0] text-[#487eb0] px-3 pt-2 pb-1 rounded-full font-bold">
                      🏆 +{task.points}
                    </div>
                    <div className="tooltip" data-tip={isCompleted ? "Task completed!" : "Verify Task!"}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent triggering the parent div's onClick
                          handleTaskSubmit(index, task);
                        }}
                        className={`btn btn-sm align-middle text-white rounded-full ${
                          isDisabled ? "bg-gray-500 cursor-not-allowed" : "bg-green-500 cursor-pointer"
                        }`}
                        disabled={isDisabled}
                      >
                        {isCompleted ? <FaCheckCircle /> : <FaStopCircle />}
                        <span className="pt-1">{isCompleted ? "Completed" : "Not Completed"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="space-y-3 text-center">
              <DotLottieReact
                src="https://lottie.host/89b50d27-5c5d-4a02-a9db-9a27c70b1f02/dMVHCVr6S0.lottie"
                loop
                autoplay
                style={{ width: "20%", maxWidth: "100%", margin: "0 auto" }}
              />
              <p className="text-black text-lg">No tasks available.</p>
            </div>
          )}
        </div>
      </div>
      <ToastContainer position="top-right" autoClose={3000} />
    </section>
  );
}