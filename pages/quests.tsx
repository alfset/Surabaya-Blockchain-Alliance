import { useState, useEffect } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db, auth } from "@/config";
import { onAuthStateChanged } from "firebase/auth";
import { BsArrowLeft } from "react-icons/bs";
import QuestCard from "@/components/card/quest";
import { Quest } from "@/types/quest";
import Link from "next/link";
import GlowingRings from "@/components/animated/glowing";
import LoadingScreen from "@/components/loading-screen";
import ErrorPage from "./error";

export default function QuestsPage() {
  const [claimableQuests, setClaimableQuests] = useState<Quest[]>([]);
  const [completedQuests, setCompletedQuests] = useState<Quest[]>([]);
  const [pastQuests, setPastQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
      @keyframes bg-scrolling-reverse {
        100% { background-position: -50px -50px; }
      }
    `;
    document.head.appendChild(styleSheet);

    return () => {
      document.head.removeChild(styleSheet);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        setError("Please sign in to view quests.");
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchQuestsAndProgress = async () => {
      if (!userId) {
        return; // Wait for user authentication
      }

      try {
        const questsSnapshot = await getDocs(collection(db, "quests"));
        const questsData = questsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          tasks: doc.data().tasks || [], // Ensure tasks is always an array
        })) as Quest[];

        const currentDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));

        // Fetch user progress for all quests
        const progressPromises = questsData.map((quest) =>
          getDocs(collection(db, "quests", quest.id, "userProgress")).then((snapshot) =>
            snapshot.docs.find((doc) => doc.id === userId)?.data() || {
              tasksCompleted: [],
              pointsCollected: 0,
              status: "pending",
            }
          )
        );
        const progressData = await Promise.all(progressPromises);

        // Categorize quests
        const claimable: Quest[] = [];
        const completed: Quest[] = [];
        const past: Quest[] = [];

        questsData.forEach((quest, index) => {
          const deadlineDate = new Date(quest.deadline);
          const isExpired = deadlineDate < currentDate || quest.status?.toLowerCase() === "end";
          const userProgress = progressData[index];
          const tasksCompleted = userProgress.tasksCompleted || [];
          const allTasksCompleted = quest.tasks.length > 0 && tasksCompleted.length === quest.tasks.length;
          const isClaimable = userProgress.status === "pending" || userProgress.status === "verified";

          if (isExpired) {
            past.push(quest);
          } else if (allTasksCompleted) {
            completed.push(quest);
          } else if (tasksCompleted.length > 0 && isClaimable) {
            claimable.push(quest);
          } else {
            completed.push(quest); // Include active quests with no progress in completed for simplicity
          }
        });

        // Sort quests: claimable and completed by deadline (ascending), past by deadline (descending)
        setClaimableQuests(claimable.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()));
        setCompletedQuests(completed.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()));
        setPastQuests(past.sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime()));
      } catch (err) {
        console.error("Error fetching quests or progress:", err);
        setError("Failed to load quests or user progress.");
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchQuestsAndProgress();
    }
  }, [userId]);

  return (
    <section className="relative bg-white min-h-screen flex flex-col text-black overflow-hidden">
      <GlowingRings />
      <div className="flex w-full text-center pt-5 pb-20 px-6 fade-in relative z-10">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="cursor-pointer w-full pb-10 overflow-hidden">
            <Link href="/quests" className="card image-full h-auto rounded-xl">
              <img
                src="./img/bg-hero.svg"
                alt="Quests"
                className="w-full h-48 object-cover bg-opacity-10 rounded-2xl"
              />
              <div className="p-10 w-full text-end z-50 space-y-2 flex items-center justify-end">
                <div className="space-y-2">
                  <span className="font-semibold text-4xl text-white break-words whitespace-nowrap">
                    Available{" "}
                    <span className="bg-gradient-to-r from-sky-400 to-indigo-600 bg-clip-text text-transparent">
                      Quests
                    </span>
                  </span>
                  <p className="font-normal text-sm flex items-center break-words whitespace-nowrap justify-end gap-2 text-gray-200">
                    <BsArrowLeft />
                    Explore and join quests to earn points!
                  </p>
                </div>
              </div>
            </Link>
          </div>

          {loading && <LoadingScreen />}

          {error && <ErrorPage error={error} />}

          {!loading && !error && (
            <>
              {/* Claimable Quests Section */}
              <div className="space-y-4">
                <h2 className="text-2xl font-semibold text-black text-left">Claimable Quests</h2>
                {claimableQuests.length === 0 ? (
                  <p className="text-gray-600 text-center">No claimable quests available.</p>
                ) : (
                  <QuestCard quests={claimableQuests} />
                )}
              </div>

              {/* Completed Quests Section */}
              <div className="space-y-4">
                <h2 className="text-2xl font-semibold text-black text-left">Completed Quests</h2>
                {completedQuests.length === 0 ? (
                  <p className="text-gray-600 text-center">No completed quests available.</p>
                ) : (
                  <QuestCard quests={completedQuests} />
                )}
              </div>

              {/* Past Quests Section */}
              <div className="space-y-4">
                <h2 className="text-2xl font-semibold text-black text-left">Past Quests</h2>
                {pastQuests.length === 0 ? (
                  <p className="text-gray-600 text-center">No past quests available.</p>
                ) : (
                  <QuestCard quests={pastQuests} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}