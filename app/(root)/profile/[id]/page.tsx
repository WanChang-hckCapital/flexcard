import Image from "next/image";
// import { currentUser } from "@clerk/nextjs";
import { redirect } from "next/navigation";

import { personalTabs } from "@/constants";

// import ThreadsTab from "@/components/shared/ThreadsTab";
// import ProfileHeader from "@/components/shared/ProfileHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { fetchMember } from "@/lib/actions/user.actions";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import ProfileHeader from "@/components/shared/ProfileHeader";
import CardsTab from "@/components/shared/CardsTab";

async function Page({ params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const user = session?.user;

    if (!user) return null;

    const userInfo = await fetchMember(params.id);
    // if (!userInfo?.onboarded) redirect("/onboarding");

    return (
        <section>
            <ProfileHeader
                accountId={userInfo.user}
                authUserId={user.id}
                accountName={userInfo.accountName}
                imgUrl={user.image}
                shortdescription={userInfo.shortdescription}
                usertype={userInfo.usertype}
                cards={userInfo.cards.length}
                followers={userInfo.followers.length}
                following={userInfo.following.length}

            />

            <div className=''>
                <Tabs defaultValue='flexCard' className='w-full'>
                    <TabsList className='tab mx-36'>
                        {personalTabs.map((tab) => (
                            <TabsTrigger key={tab.label} value={tab.value} className='tab'>
                                <Image
                                    src={tab.icon}
                                    alt={tab.label}
                                    width={24}
                                    height={24}
                                    className='object-contain'
                                />
                                <p className='max-sm:hidden'>{tab.label}</p>

                                {tab.label === "CARDS" && (
                                    <p className='ml-1 rounded-sm bg-light-4 px-2 py-1 !text-tiny-medium text-light-2'>
                                        {userInfo.cards.length}
                                    </p>
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {personalTabs.map((tab) => (
                        <TabsContent
                            key={`content-${tab.label}`}
                            value={tab.value}
                            className='w-full text-light-1'
                        >
                            <CardsTab
                                currentUserId={user.id}
                                accountId={params.id}
                                userType='PERSONAL'
                            />
                        </TabsContent>
                    ))}
                </Tabs>
            </div>
        </section>
    );
}
export default Page;
