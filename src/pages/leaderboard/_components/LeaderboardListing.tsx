import Image from "next/image";
import React, { useCallback, useEffect, useState } from "react";
import { FaChevronDown } from "react-icons/fa6";
import { useAccount } from "wagmi";
import {
  ApiResponse,
  EnrichedRankingData,
  User,
  Rankings,
  Pagination,
  UserRank,
  RankingData,
} from "~/components/SectionTwo";
import { cn } from "~/utils/helpers";

const PaginationButton: React.FC<{
  page: number | string;
  isActive: boolean;
  onClick: () => void;
}> = ({ page, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`h-8 w-8 rounded-full border text-sm font-medium ${isActive
      ? "border-purple-800 bg-purple-800 text-white"
      : "border-gray-300 bg-transparent text-gray-600 hover:bg-gray-100"
      } mx-0.5`}
  >
    {page}
  </button>
);

const LeaderboardListing: React.FC = () => {
  const tabs = [
    {
      title: "Top Bren Recipients",
      key: "tipsReceived",
      header: "BREN Earned",
    },
    { title: "Top Bren Givers", key: "tipsSent", header: "BREN Given" },
    {
      title: "Top Shoutout Recipients",
      key: "tipsReceivedCount",
      header: "Shoutouts",
    },
    { title: "Top Shoutout Givers", key: "tipsSentCount", header: "Shoutouts" },
  ];
  const [selectedTab, setSelectedTab] = useState(tabs[0]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 50, // Increased from 20 to 50
  });
  const [displayedRankings, setDisplayedRankings] = useState<EnrichedRankingData[]>([]);
  const [userRanking, setUserRanking] = useState<UserRank | null>(null);
  const { address } = useAccount();

  const filterAndSortRankings = useCallback((rankings: EnrichedRankingData[]) => {
    const filteredRankings = rankings.filter((ranking) => {
      const metric = ranking[selectedTab?.key as keyof Rankings];
      return metric !== 0 && metric !== null;
    });

    const sortedRankings = filteredRankings.sort((a, b) => {
      const metricA = a[selectedTab?.key as keyof Rankings] as number;
      const metricB = b[selectedTab?.key as keyof Rankings] as number;
      return metricB - metricA;
    });

    return sortedRankings;
  }, [selectedTab]);

  const fetchUserRanking = async () => {
    if (!address) return;
    try {
      const response = await fetch(
        `/api/user-ranking?address=${address}&sort=${selectedTab?.key}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch user ranking");
      }
      const data: UserRank = await response.json();
      setUserRanking(data);
    } catch (error) {
      console.error("Error fetching user ranking:", error);
    }
  };

  const fetchRankings = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/db-rankings?sort=${selectedTab?.key}&page=${currentPage}&limit=${pagination.itemsPerPage}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch rankings");
      }
      const data: ApiResponse = await response.json();

      // Helper function to fetch user details by FIDs
      const fetchUserDetailsByFids = async (fids: number[]): Promise<User[]> => {
        try {
          const userResponse = await fetch(`/api/neynar-users?fids=${fids.join(',')}`);
          if (!userResponse.ok) {
            return [];
          }
          const userData: { users: User[] } = await userResponse.json();
          return userData.users;
        } catch (error) {
          console.error(`Error fetching user details for FIDs:`, error);
          return [];
        }
      };

      // Helper function to fetch user details by wallet addresses
      const fetchUserDetailsByAddresses = async (addresses: string[]): Promise<Record<string, User[]>> => {
        try {
          const userResponse = await fetch(`/api/neynar-users-by-address?addresses=${addresses.join(',')}`);
          if (!userResponse.ok) {
            return {};
          }
          return await userResponse.json();
        } catch (error) {
          console.error(`Error fetching user details for addresses:`, error);
          return {};
        }
      };

      // Group rankings by FID and wallet address
      const fidGroup: number[] = [];
      const addressGroup: string[] = [];
      const tgUsernameGroup: { ranking: RankingData; tgUsername: string }[] = [];

      data.data.forEach(ranking => {
        if (ranking.fid) {
          fidGroup.push(ranking.fid);
        } else if (ranking.walletAddress) {
          addressGroup.push(ranking.walletAddress);
        } else if (ranking.tgUsername) {
          tgUsernameGroup.push({ ranking, tgUsername: ranking.tgUsername });
        }
      });

      // Fetch user details in batches
      const userDetailsByFid = await fetchUserDetailsByFids(fidGroup);
      const userDetailsByAddress = await fetchUserDetailsByAddresses(addressGroup);

      // Combine all user details
      const enrichedRankings: EnrichedRankingData[] = data.data.map(ranking => {
        let userDetails: User | null | undefined;
        if (ranking.fid) {
          userDetails = userDetailsByFid.find(user => user.fid === ranking.fid) || null;
        } else if (ranking.walletAddress) {
          userDetails = userDetailsByAddress[ranking.walletAddress.toLowerCase()]?.[0] || null;
        } else if (ranking.tgUsername) {
          userDetails = {
            username: ranking.tgUsername,
            display_name: ranking.tgUsername,
            pfp_url: null,
          } as User;
        } else {
          userDetails = null;
        }

        return {
          ...ranking,
          userDetails,
          fid: ranking.fid || null,
          walletAddress: ranking.walletAddress || null,
          tgUsername: ranking.tgUsername || null,
          rank: ranking.rank
        };
      });

      const filteredAndSortedRankings = filterAndSortRankings(enrichedRankings);

      // Calculate base rank for current page
      const baseRank = (currentPage - 1) * pagination.itemsPerPage;

      // Add display ranks to all rankings
      const rankingsWithDisplayRanks = filteredAndSortedRankings.map((ranking, index) => ({
        ...ranking,
        displayRank: baseRank + index + 1 // Start from 1 for each page
      }));

      setDisplayedRankings(rankingsWithDisplayRanks);

      // Update pagination using the pagination data from the API response
      setPagination({
        ...pagination,
        ...data.pagination,
        currentPage: currentPage
      });

    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        await fetchRankings();
        if (currentPage === 1) {
          await fetchUserRanking();
        } else {
          setUserRanking(null);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedTab, currentPage]);

  // Pagination calculations
  const maxVisiblePages = 15;
  const halfVisiblePages = Math.floor(maxVisiblePages / 2);

  let startPage = Math.max(pagination.currentPage - halfVisiblePages, 1);
  const endPage = Math.min(
    startPage + maxVisiblePages - 1,
    pagination.totalPages
  );

  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(endPage - maxVisiblePages + 1, 1);
  }

  const pageNumbers = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i
  );

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  return (
    <div className="mx-auto mt-12 w-full max-w-[1200px] px-5 lg:px-10">
      <div className="mx-auto hidden w-full items-center justify-between rounded-[14px] bg-[#2C9569] px-16 lg:flex">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={cn(
              "relative cursor-pointer py-5 text-center text-xl text-white",
              {
                "active-tab text-Y-100": selectedTab?.key === tab.key,
              },
            )}
            onClick={() => setSelectedTab(tab)}
          >
            {tab.title}
          </div>
        ))}
      </div>
      <div className="mx-auto mt-6 w-fit lg:hidden">
        <div className="relative inline-block">
          <select
            value={selectedTab?.key}
            className="w-full appearance-none rounded-lg bg-[#31AE7A] px-2 py-2 text-sm font-medium text-[#FFFC00]"
            onChange={(e) => {
              const newkey = e.target.value;
              setSelectedTab(tabs?.find((t) => t?.key === newkey));
            }}
          >
            {tabs?.map((tab) => (
              <option key={tab?.key} value={tab?.key}>
                {tab?.title}
              </option>
            ))}
          </select>
          <FaChevronDown className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#FFFC00]" />
        </div>
      </div>

      <div className="mx-auto mt-6 w-full rounded-xl border border-B-40 bg-white">
        <div className="grid w-full grid-cols-[40px_60px_1fr_90px] gap-4 border-b-[0.5px] border-B-40 px-3 py-2.5 text-xs font-bold text-B-100 lg:grid-cols-[60px_200px_1fr_284px] lg:gap-20 lg:px-8 lg:py-5 lg:text-xl">
          <h1>Rank</h1>
          <h1 className="text-center">Profile</h1>
          <h1 className="">Name</h1>
          <h1 className="text-center">{selectedTab?.header}</h1>
        </div>

        <div className="divide-y-[0.5px] divide-B-40">
          {loading ? (
            <div className="py-4 text-center">Loading...</div>
          ) : (
            <>
              {displayedRankings.map((ranking) => (
                <div
                  className="grid w-full grid-cols-[40px_60px_1fr_90px] items-center gap-4 px-3 py-2.5 lg:grid-cols-[60px_200px_1fr_284px] lg:gap-20 lg:px-8 lg:py-5"
                  key={ranking.fid || ranking.walletAddress || ranking.tgUsername}
                >
                  <h1 className="text-center text-xs text-B-60 lg:text-lg">
                    {String(ranking.displayRank).padStart(2, "0")}
                  </h1>
                  <div className="w-full">
                    <a
                      href={`https://warpcast.com/${ranking.userDetails?.username || ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex justify-center"
                    >
                      {ranking.userDetails?.pfp_url && (
                        <img
                          alt="Profile"
                          src={ranking.userDetails.pfp_url}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      )}
                    </a>
                  </div>
                  <div className="flex w-full items-center gap-2 overflow-hidden">
                    <div className="relative h-[14px] w-[14px] lg:h-[22px] lg:w-[22px]">
                      <Image
                        src="/icons/bolt_circle.svg"
                        alt="Bolt"
                        layout="fill"
                      />
                    </div>
                    <a
                      href={`https://warpcast.com/${ranking.userDetails?.username || ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-xs text-B-60 lg:text-lg"
                    >
                      {ranking.userDetails?.username ||
                        `${ranking.walletAddress?.slice(0, 6)}...${ranking.walletAddress?.slice(-4)}`}
                    </a>
                  </div>
                  <p className="text-center text-xs text-B-60 lg:text-base">
                    {(ranking[
                      selectedTab?.key as keyof EnrichedRankingData
                    ] as number) || 0}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        {pagination.totalPages > 1 && (
          <div className="flex items-center">
            {startPage > 1 && (
              <>
                <PaginationButton
                  page={1}
                  isActive={false}
                  onClick={() => handlePageChange(1)}
                />
                {startPage > 2 && <span className="mx-1">...</span>}
              </>
            )}

            {pageNumbers.map((page) => (
              <PaginationButton
                key={page}
                page={page}
                isActive={page === pagination.currentPage}
                onClick={() => handlePageChange(page)}
              />
            ))}

            {endPage < pagination.totalPages && (
              <>
                {endPage < pagination.totalPages - 1 && <span className="mx-1">...</span>}
                <PaginationButton
                  page={pagination.totalPages}
                  isActive={false}
                  onClick={() => handlePageChange(pagination.totalPages)}
                />
              </>
            )}
          </div> )}
        <span className="ml-4 text-sm text-gray-500">
          {`${(pagination.currentPage - 1) * pagination.itemsPerPage + 1}-${Math.min(pagination.currentPage * pagination.itemsPerPage, pagination.totalItems)} of ${pagination.totalItems}`}
        </span>
      </div>
    </div>
  );
};

export default LeaderboardListing;