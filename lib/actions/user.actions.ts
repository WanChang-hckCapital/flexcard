"use server";

import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import { revalidatePath } from "next/cache";

import { connectToDB } from "../mongodb";
import Member from "../models/member";
import Card from "../models/card";
import Image from "../models/image";
import UserModel from "../models/user";
import FriendRequestModel from "../models/friendrequest";
import FriendModel from "../models/friend";
import FollowRequestModel from "../models/followrequest";
import Organization from "../models/organization";
import { Readable } from "stream";
import { headers } from "next/headers";
import { addMinutes, startOfDay, subMinutes } from "date-fns";
import ComponentModel from "../models/component";
import MemberModel from "../models/member";
import liff from "@line/liff";
import axios from "axios";
import ProductModel from "../models/product";
import FeedbackModel from "../models/feedback";

export async function authenticateUser(email: string, password: string) {
  try {
    await connectToDB();

    const user = await Member.findOne({ email });
    if (!user) {
      return null;
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (passwordMatch) {
      const strUser = user.toString();
      console.log(strUser);
      return strUser;
    } else {
      return null;
    }
  } catch (error: any) {
    throw new Error(`Failed to authenticate user: ${error.message}`);
  }
}

export async function createUser(
  email: string,
  username: string,
  password: string
) {
  try {
    await connectToDB();

    const existingUser = await Member.findOne({ email: email });
    if (existingUser) {
      throw new Error("User with this email already exists.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await Member.create({
      email,
      username,
      password: hashedPassword,
    });

    return newUser;
  } catch (error: any) {
    throw new Error(`Failed to create user: ${error.message}`);
  }
}

export async function createMember(userId: string) {
  try {
    await connectToDB();

    const existingMember = await Member.findOne({ user: userId });

    if (!existingMember) {
      const newMember = new Member({
        user: userId,
      });

      await newMember.save();
      return true;
    }

    return false;
  } catch (error: any) {
    throw new Error(`Failed to create member: ${error.message}`);
  }
}

export async function getIPCountryInfo() {
  if (process.env.NODE_ENV === "development") {
    // const ip = "2001:f40:983:ca54:11c7:d9be:7e0c:eab1" // MY IP address for testing
    const ip = "103.123.240.66"; // TW IP address for testing
    return fetch(`http://ip-api.com/json/${ip}`)
      .then((response) => response.json())
      .then((data) => {
        return {
          ip: data.query,
          country: data.country,
          countryCode: data.countryCode,
          region: data.regionName,
          city: data.city,
        };
      });
  } else {
    const headersList = headers();
    const ip = headersList.get("request-ip");
    return fetch(`http://ip-api.com/json/${ip}`)
      .then((response) => response.json())
      .then((data) => {
        return {
          ip: data.query,
          country: data.country,
          countryCode: data.countryCode,
          region: data.regionName,
          city: data.city,
        };
      });
  }
}

export async function getGeoInfoByIP(ipAddress: string) {
  return fetch(`http://ip-api.com/json/${ipAddress}`)
    .then((response) => response.json())
    .then((data) => {
      return {
        ip: data.query,
        country: data.country,
        countryCode: data.countryCode,
        region: data.regionName,
        city: data.city,
      };
    });
}

export async function updateLastLoginDateAndIP(
  userId: string,
  ipAddress: string
) {
  try {
    await connectToDB();

    const member = await Member.findOne({ user: userId });

    if (!member) {
      throw new Error("Member not found");
    }

    const lastLoginDateTime = new Date();

    if (member.ip_address !== ipAddress) {
      const oldGeoInfo = await getGeoInfoByIP(member.ip_address);
      const newGeoInfo = await getGeoInfoByIP(ipAddress);

      if (!oldGeoInfo || !newGeoInfo || oldGeoInfo.city !== newGeoInfo.city) {
        await Member.findOneAndUpdate(
          { user: userId },
          {
            lastlogin: lastLoginDateTime,
            ip_address: ipAddress,
          },
          { upsert: true }
        );
      } else {
        await Member.findOneAndUpdate(
          { user: userId },
          { lastlogin: lastLoginDateTime },
          { upsert: true }
        );
      }
    } else {
      await Member.findOneAndUpdate(
        { user: userId },
        { lastlogin: lastLoginDateTime },
        { upsert: true }
      );
    }

    return true;
  } catch (error: any) {
    throw new Error(`Failed to update last login date: ${error.message}`);
  }
}

export async function fetchMemberImage(imageId: string) {
  try {
    await connectToDB();

    const imageUrl = await Image.findOne({ _id: imageId });

    return imageUrl;
  } catch (error: any) {
    throw new Error(`Failed to fetch Image: ${error.message}`);
  }
}

interface ParamsUpdateProfileViewData {
  userId?: string;
  authUserId: string;
}

export async function updateProfileViewData({
  userId,
  authUserId,
}: ParamsUpdateProfileViewData) {
  const now = new Date();
  const threeMinutesAgo = subMinutes(now, 3);

  try {
    await connectToDB();

    if (userId === authUserId) {
      console.log(
        `${authUserId} view ${userId} considered same user and not recorded.`
      );
      return null;
    }

    const member = await Member.findOne({ user: userId });
    if (!member) {
      throw new Error("Member not found");
    }

    const lastView = member.viewDetails.find(
      (v: { viewerId: { toString: () => string | undefined } }) =>
        v.viewerId.toString() === authUserId
    );
    if (lastView && lastView.viewedAt > threeMinutesAgo) {
      console.log(
        `${authUserId} view ${authUserId} considered spam and not recorded.`
      );
      return null;
    }

    const result = await Member.findOneAndUpdate(
      { user: userId },
      {
        $inc: { totalViews: 1 },
        $push: {
          viewDetails: {
            viewerId: authUserId,
            viewedAt: now,
          },
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    return result;
  } catch (error) {
    console.error("Failed to update Profile view data:", error);
    throw error;
  }
}

export async function fetchProfileViewDetails(
  authenticatedUserId: string,
  startDate: Date | null,
  endDate: Date | null
): Promise<{ success: boolean; data?: any[]; message?: string }> {
  try {
    await connectToDB();

    if (endDate === null) {
      endDate = new Date();
    }

    const query = {
      user: authenticatedUserId,
      "viewDetails.viewedAt": { $gte: startDate, $lte: endDate },
    };
    const member = await Member.findOne(query).select("viewDetails");

    if (!member) {
      throw new Error("Member not found");
    }

    const views = member.viewDetails;
    const dayMap = new Map();

    views.forEach((view: { viewedAt: string | number | Date }) => {
      const date = new Date(view.viewedAt).toISOString().slice(0, 10);
      dayMap.set(date, (dayMap.get(date) || 0) + 1);
    });

    const chartData = Array.from(dayMap).map(([date, count]) => ({
      date,
      totalViews: count,
    }));

    return { success: true, data: chartData };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to fetch profile view details: ${error.message}`,
    };
  }
}

export async function fetchFollowersByDateRange(
  authenticatedUserId: string,
  startDate: Date | null,
  endDate: Date | null
): Promise<{ success: boolean; data?: any[]; message?: string }> {
  try {
    await connectToDB();

    if (endDate === null) {
      endDate = new Date();
    }

    console.log("authenticatedUserId: " + authenticatedUserId);

    const query = {
      user: authenticatedUserId,
      "followers.followedAt": { $gte: startDate, $lte: endDate },
    };
    const member = await Member.findOne(query).select("followers");

    if (!member) {
      throw new Error("Member not found");
    }

    const followers = member.followers;

    console.log("Followers: " + JSON.stringify(followers));
    const dayMap = new Map();

    followers.forEach((follower: { followedAt: string | number | Date }) => {
      const date = new Date(follower.followedAt).toISOString().slice(0, 10);
      dayMap.set(date, (dayMap.get(date) || 0) + 1);
    });

    const chartData = Array.from(dayMap).map(([date, count]) => ({
      date,
      totalFollowedUser: count,
    }));

    console.log("chartData: " + JSON.stringify(chartData));

    return { success: true, data: chartData };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to fetch Follower details: ${error.message}`,
    };
  }
}

// not working
export async function fetchUser(userId: string) {
  try {
    await connectToDB();

    const db = mongoose.connection.getClient().db();
    const testCollection = db.collection("test");

    const cursor = testCollection.find({ "users.user": userId });
    const userArray = await cursor.toArray();

    console.log("User123: " + JSON.stringify(userArray));

    return userArray;
  } catch (error: any) {
    throw new Error(`Failed to fetch User: ${error.message}`);
  }
}

type CheckIfFollowingParams = {
  authUserId: string;
  accountId: string;
};

export async function checkIfFollowing({
  authUserId,
  accountId,
}: CheckIfFollowingParams): Promise<{
  success: boolean;
  isFollowing: boolean;
  message?: string;
}> {
  try {
    await connectToDB();

    const currentMember = await Member.findOne({ user: authUserId });
    const accountMember = await Member.findOne({ user: accountId });

    if (!currentMember || !accountMember) {
      throw new Error("Current member or account member not found");
    }

    const isFollowing = currentMember.following.includes(accountId.toString());

    return { success: true, isFollowing };
  } catch (error: any) {
    return {
      success: false,
      isFollowing: false,
      message: `Failed to check following status: ${error.message}`,
    };
  }
}

interface ParamUpdateMemberFollowData {
  authUserId: string;
  accountId: string;
  method: "FOLLOW" | "UNFOLLOW";
}

export async function updateMemberFollow({
  authUserId,
  accountId,
  method,
}: ParamUpdateMemberFollowData): Promise<{
  success: boolean;
  data?: any;
  message?: string;
}> {
  try {
    await connectToDB();

    const now = new Date();
    const threeMinutesAgo = subMinutes(now, 3);

    const currentMember = await Member.findOne({ user: authUserId });
    const accountMember = await Member.findOne({ user: accountId });

    if (!currentMember || !accountMember) {
      throw new Error("Current member not found");
    }

    const userUpdateTimestamps =
      accountMember.updateHistory?.filter(
        (update: any) => update.userId.toString() === authUserId
      ) || [];
    const recentUpdatesCount = userUpdateTimestamps.filter(
      (update: any) => update.timestamp > threeMinutesAgo
    ).length;

    if (recentUpdatesCount >= 5) {
      const nextAvailableTime = addMinutes(
        userUpdateTimestamps[0].timestamp,
        3
      ).toLocaleTimeString();
      return {
        success: false,
        message: `Although We know you like this profile so much but unfortunately You have reach the modify limits for follow this profile, Please Try again in ${nextAvailableTime}.`,
      };
    }

    let updatedFollowing: string[] = currentMember.following.map(
      (f: { toString: () => any }) => f.toString()
    );
    let updateFollower = [...accountMember.followers];

    if (method.toUpperCase() === "FOLLOW") {
      if (!updatedFollowing.includes(accountId.toString())) {
        updatedFollowing.push(accountId.toString());
      }
      if (
        !updateFollower.some(
          (follower) => follower.followersId.toString() === authUserId
        )
      ) {
        updateFollower.push({
          followersId: authUserId,
          followedAt: new Date(),
        });
      }
    } else if (method.toUpperCase() === "UNFOLLOW") {
      updatedFollowing = updatedFollowing.filter((id) => id !== accountId);
      updateFollower = updateFollower.filter(
        (follower) => follower.followersId.toString() !== authUserId
      );
    }

    await Promise.all([
      Member.findByIdAndUpdate(currentMember._id, {
        following: updatedFollowing,
      }),
      Member.findByIdAndUpdate(accountMember._id, {
        followers: updateFollower,
      }),
      Member.findByIdAndUpdate(accountMember._id, {
        $push: { updateHistory: { userId: authUserId, timestamp: now } },
      }),
    ]);

    const safeUpdatedFollower = updateFollower.map((follower) => ({
      followersId: follower.followersId.toString(),
      followedAt: follower.followedAt,
    }));

    return {
      success: true,
      data: { updatedFollowing, updateFollower: safeUpdatedFollower },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to follow/unfollow user: ${error.message}`,
    };
  }
}

export async function getLikeCount(cardId: string) {
  try {
    await connectToDB();
    const card = await Card.findById(cardId);
    if (!card) throw new Error("Card not found");
    return { success: true, likes: card.likes.length };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

interface ParamsCardLikes {
  authUserId: string;
  cardId: string;
}

export async function updateCardLikes(params: ParamsCardLikes): Promise<{
  success: boolean;
  data?: any[];
  reachedLimit: boolean;
  message?: string;
}> {
  try {
    await connectToDB();

    const now = new Date();
    const threeMinutesAgo = subMinutes(now, 3);

    const { authUserId, cardId } = params;

    const authUserIdSanitized = authUserId.trim();

    const card = await Card.findOne({ _id: cardId });

    if (!card) {
      throw new Error("Card not found");
    }

    const userUpdateTimestamps =
      card.updateHistory?.filter(
        (update: any) => update.userId.toString() === authUserId
      ) || [];

    const recentUpdatesCount = userUpdateTimestamps.filter(
      (update: any) => update.timestamp > threeMinutesAgo
    ).length;

    if (recentUpdatesCount >= 5) {
      const nextAvailableTime = addMinutes(
        userUpdateTimestamps[0].timestamp,
        3
      ).toLocaleTimeString();
      return {
        success: false,
        message: `Although We know you like this card so much but unfortunately You have reach the like limits for this card, Please Try again in ${nextAvailableTime}.`,
        reachedLimit: true,
      };
    }

    let update;
    const userHasLiked = card.likes.includes(authUserId);

    if (userHasLiked) {
      update = {
        $pull: { likes: authUserIdSanitized },
        $push: {
          updateHistory: { userId: authUserIdSanitized, timestamp: now },
        },
      };
    } else {
      update = {
        $addToSet: { likes: authUserIdSanitized },
        $push: {
          updateHistory: { userId: authUserIdSanitized, timestamp: now },
        },
      };
    }

    const updatedCard = await Card.findByIdAndUpdate(card._id, update, {
      new: true,
    });

    if (!updatedCard) {
      throw new Error("Update failed");
    }

    // update and return likes after fetch user image
    const likesDetails = await Promise.all(
      updatedCard.likes.map(async (likeId: any) => {
        const likeUser = await MemberModel.findOne({ user: likeId }).select(
          "accountname image"
        );
        if (likeUser && likeUser.image) {
          const imageDoc = await Image.findById(likeUser.image).select(
            "binaryCode"
          );
          return {
            accountname: likeUser.accountname,
            binarycode: imageDoc ? imageDoc.binaryCode : undefined,
          };
        }
        return {
          accountname: likeUser ? likeUser.accountname : "Unknown",
          binarycode: undefined,
        };
      })
    );

    return { success: true, data: likesDetails, reachedLimit: false };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to update card likes: ${error.message}`,
      reachedLimit: false,
    };
  }
}

interface ParamsUpdWebURL {
  authUserId: string;
  url: string;
}

export async function updateOrganizationUrl(
  params: ParamsUpdWebURL
): Promise<void> {
  try {
    await connectToDB();

    const { authUserId, url } = params;
    const currentMember = await Member.findOne({ user: authUserId });

    if (!currentMember) {
      throw new Error("Current member not found");
    }

    if (currentMember.usertype.toUpperCase() !== "ORGANIZATION") {
      throw new Error("Current member isn't Organization owner.");
    }

    const organization = await Organization.findOne({
      organizationID: currentMember._id,
    });

    if (!organization) {
      throw new Error("Organization not found");
    }

    organization.webUrl = url;

    await organization.save();
  } catch (error: any) {
    throw new Error(`Failed to update weburl: ${error.message}`);
  }
}

//not using
export async function uploadImageToGridFS(
  file: File,
  filename: string
): Promise<string> {
  try {
    await connectToDB();

    const db = mongoose.connection.getClient().db();
    const bucket = new GridFSBucket(db);

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const readableStream = new Readable();
    readableStream.push(fileBuffer);
    readableStream.push(null);

    const uploadStream = bucket.openUploadStream(filename);
    const uploadPromise = new Promise<string>((resolve, reject) => {
      uploadStream.once("finish", () => {
        resolve(uploadStream.id.toString());
      });
      uploadStream.once("error", (err) => {
        reject("Something went wrong: " + err);
      });
    });

    readableStream.pipe(uploadStream);

    return await uploadPromise;
  } catch (error: any) {
    throw new Error(`Failed to upload image to GridFS: ${error.message}`);
  }
}

interface ParamsMemberDetails {
  userId: string;
  accountname: string;
  email: string;
  password: string;
  phone: string;
  shortdescription: string;
  ip_address: string;
  country?: string;
  countrycode?: string;
  image?: {
    binaryCode: string;
    name: string;
  };
  path: string;
}

type UpdateMemberData = {
  accountname: string;
  email: string;
  password: string;
  phone: string;
  shortdescription: string;
  ip_address: string;
  image?: any;
  onboarded: boolean;
  country?: string;
  countrycode?: string;
};

export async function updateMemberDetails({
  userId,
  accountname,
  email,
  password,
  phone,
  shortdescription,
  ip_address,
  country,
  countrycode,
  image,
  path,
}: ParamsMemberDetails): Promise<void> {
  try {
    await connectToDB();

    const existingUser = await Member.findOne({ email: email });
    if (existingUser && path != "/profile/edit") {
      throw new Error("User with this email already exists.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let updateData: UpdateMemberData;
    if (image) {
      const savedImage = await Image.create({
        binaryCode: image.binaryCode,
        name: image.name,
      });
      const imageId = savedImage._id;
      updateData = {
        accountname: accountname,
        email: email,
        password: hashedPassword,
        phone: phone,
        shortdescription: shortdescription,
        ip_address: ip_address,
        image: imageId,
        onboarded: true,
      };
    } else {
      updateData = {
        accountname: accountname,
        email: email,
        password: hashedPassword,
        phone: phone,
        shortdescription: shortdescription,
        ip_address: ip_address,
        onboarded: true,
      };
    }

    if (path !== "/profile/edit") {
      updateData.country = country;
      updateData.countrycode = countrycode;
    }

    await Member.findOneAndUpdate({ user: userId }, updateData, {
      upsert: true,
    });

    if (path === "/profile/edit") {
      revalidatePath(path);
    }
  } catch (error: any) {
    throw new Error(`Failed to create/update user: ${error.message}`);
  }
}

interface ParamsUpdateCardViewData {
  userId?: string;
  cardId: string;
}

export async function updateCardViewData({
  userId,
  cardId,
}: ParamsUpdateCardViewData) {
  const now = new Date();
  const threeMinutesAgo = subMinutes(now, 3);

  try {
    const card = await Card.findById(cardId);
    if (!card) {
      throw new Error("Card not found");
    }

    const lastView = card.viewDetails.find(
      (v: { viewerId: { toString: () => string | undefined } }) =>
        v.viewerId.toString() === userId
    );
    if (lastView && lastView.viewedAt > threeMinutesAgo) {
      console.log(`${userId} view ${cardId} considered spam and not recorded.`);
      return null;
    }

    const today = startOfDay(new Date());
    const result = await Card.findByIdAndUpdate(
      cardId,
      {
        $inc: { totalViews: 1 },
        $push: {
          viewDetails: {
            viewerId: userId,
            viewedAt: now,
          },
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    return result;
  } catch (error) {
    console.error("Failed to update card view data:", error);
    throw error;
  }
}

export async function fetchCardViewDetails(
  cardId: string,
  startDate: Date | null,
  endDate: Date | null
): Promise<{ success: boolean; data?: any[]; message?: string }> {
  try {
    await connectToDB();

    if (endDate === null) {
      endDate = new Date();
    }

    const query = {
      _id: cardId,
      "viewDetails.viewedAt": { $gte: startDate, $lte: endDate },
    };
    const card = await Card.findOne(query).select("viewDetails");

    if (!card) {
      throw new Error("Card not found");
    }

    const views = card.viewDetails;
    const dayMap = new Map();

    views.forEach((view: { viewedAt: string | number | Date }) => {
      const date = new Date(view.viewedAt).toISOString().slice(0, 10);
      dayMap.set(date, (dayMap.get(date) || 0) + 1);
    });

    const chartData = Array.from(dayMap).map(([date, count]) => ({
      date,
      totalViews: count,
    }));

    return { success: true, data: chartData };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to fetch card view details: ${error.message}`,
    };
  }
}

export async function fetchOnlyCardId(userId: string) {
  try {
    await connectToDB();

    const cardId = await Member.findOne({ user: userId }).select("cards");
    const cardWithTitle = await Card.find({
      _id: { $in: cardId.cards },
    }).select("title");

    return cardWithTitle;
  } catch (error) {
    console.error("Error fetching cards:", error);
    throw error;
  }
}

export async function fetchPersonalCards(userId: string) {
  try {
    await connectToDB();

    const member = await Member.findOne({ user: userId });

    if (!member) {
      throw new Error(`Member with ID ${userId} not found.`);
    }

    if (!member.cards) {
      throw new Error(`Member with ID ${userId} has no cards.`);
    }

    const cards = await Card.find({
      _id: { $in: member.cards },
    });

    const cardsData = await Promise.all(
      cards.map(async (card) => {
        const creator = await MemberModel.findOne({
          user: card.creator,
        }).select("accountname image");
        const creatorImage = await Image.findOne({ _id: creator.image }).select(
          "binaryCode"
        );
        const creatorData = {
          accountname: creator ? creator.accountname : "Unknown",
          image: creator && creatorImage ? creatorImage.binaryCode : undefined,
        };

        // const componentInCard = await Card.findOne({ _id: card }).select('components');
        const lineComponents = await Card.findOne({ _id: card }).select(
          "lineFormatComponent"
        );

        const likesDetails = await Promise.all(
          card.likes.map(async (likeId: any) => {
            const likeUser = await MemberModel.findOne({ user: likeId }).select(
              "user accountname image"
            );

            if (likeUser && likeUser.image) {
              const imageDoc = await Image.findById(likeUser.image).select(
                "binaryCode"
              );
              return {
                userId: likeUser.user.toString(),
                accountname: likeUser.accountname,
                binarycode: imageDoc ? imageDoc.binaryCode : undefined,
              };
            }
            return {
              userId: likeUser.user.toString(),
              accountname: likeUser ? likeUser.accountname : "Unknown",
              binarycode: undefined,
            };
          })
        );

        const flexFormatHTML = await Card.findOne({ _id: card }).select(
          "flexFormatHtml"
        );

        const followers = await Promise.all(
          card.followers.map((id: any) =>
            MemberModel.find({ user: id }).select("accountname")
          )
        );
        // const followersImage = await Promise.all(card.followers.map((id: any) => MemberModel.findById(id).select('image')));
        // const followersImageBinary = await Promise.all(followersImage.map((image: any) => Image.find(image.image).select('binaryCode')));
        // const components = await ComponentModel.findOne({ _id: componentInCard.components }).select('content');
        const lineFormatComponent = await ComponentModel.findOne({
          _id: lineComponents.lineFormatComponent,
        }).select("content");
        const flexFormatHTMLContent = await ComponentModel.findOne({
          _id: flexFormatHTML.flexFormatHtml,
        }).select("content");

        return {
          cardId: card._id.toString(),
          title: card.title,
          creator: creatorData,
          likes: likesDetails,
          followers: followers.map((follower) => ({
            accountname: follower.accountname,
          })),
          // components: {
          //     content: components ? components.content : undefined,
          // },
          lineComponents: {
            content: lineFormatComponent
              ? lineFormatComponent.content
              : undefined,
          },
          flexHtml: {
            content: flexFormatHTMLContent
              ? flexFormatHTMLContent.content
              : undefined,
          },
        };
      })
    );

    return cardsData;
  } catch (error) {
    console.error("Error fetching personal cards:", error);
    throw error;
  }
}

export async function fetchAllCards() {
  try {
    await connectToDB();

    const cards = await Card.find();

    const cardsData = await Promise.all(
      cards.map(async (card) => {
        const creator = await MemberModel.findOne({
          user: card.creator,
        }).select("accountname image");
        const creatorImage = await Image.findOne({ _id: creator.image }).select(
          "binaryCode"
        );
        const creatorData = {
          accountname: creator ? creator.accountname : "Unknown",
          image: creator && creatorImage ? creatorImage.binaryCode : undefined,
        };

        const lineComponents = await Card.findOne({ _id: card }).select(
          "lineFormatComponent"
        );

        const likesDetails = await Promise.all(
          card.likes.map(async (likeId: any) => {
            const likeUser = await MemberModel.findOne({ user: likeId }).select(
              "user accountname image"
            );
            if (likeUser && likeUser.image) {
              const imageDoc = await Image.findById(likeUser.image).select(
                "binaryCode"
              );
              return {
                userId: likeUser.user.toString(),
                accountname: likeUser.accountname,
                binarycode: imageDoc ? imageDoc.binaryCode : undefined,
              };
            }
            return {
              userId: likeUser.user.toString(),
              accountname: likeUser ? likeUser.accountname : "Unknown",
              binarycode: undefined,
            };
          })
        );

        const flexFormatHTML = await Card.findOne({ _id: card }).select(
          "flexFormatHtml"
        );

        const followers = await Promise.all(
          card.followers.map((id: any) =>
            MemberModel.find({ user: id }).select("accountname")
          )
        );

        const lineFormatComponent = await ComponentModel.findOne({
          _id: lineComponents.lineFormatComponent,
        }).select("content");
        const flexFormatHTMLContent = await ComponentModel.findOne({
          _id: flexFormatHTML.flexFormatHtml,
        }).select("content");

        return {
          cardId: card._id.toString(),
          title: card.title,
          creator: creatorData,
          likes: likesDetails,
          followers: followers.map((follower) => ({
            accountname: follower.accountname,
          })),
          lineComponents: {
            content: lineFormatComponent
              ? lineFormatComponent.content
              : undefined,
          },
          flexHtml: {
            content: flexFormatHTMLContent
              ? flexFormatHTMLContent.content
              : undefined,
          },
        };
      })
    );

    return cardsData;
  } catch (error) {
    console.error("Error fetching all cards:", error);
    throw error;
  }
}

export async function fetchProductPlanLimitedCardQuantity(
  productId: string
): Promise<number> {
  try {
    await connectToDB();

    const product = await ProductModel.findById(productId);

    if (!product) {
      throw new Error("Product not found");
    }

    return product.limitedCard;
  } catch (error: any) {
    console.error("Error fetching product plan limited card quantity:", error);
    throw error;
  }
}

export async function fetchMemberCardsLength(
  memberId: string
): Promise<number> {
  try {
    await connectToDB();

    const member = await MemberModel.findOne({ user: memberId }).populate(
      "cards"
    );

    if (!member) {
      throw new Error("Member not found");
    }

    return member.cards.length;
  } catch (error: any) {
    console.error("Error fetching member cards length:", error);
    throw error;
  }
}

interface FeedbackProps {
  selectedReasons: string[];
  otherReason: string;
  hasUsedSimilar: boolean;
  similarAppName: string;
  feedbackComment: string;
  isSkip: boolean;
  userId: string;
}

export async function submitFeedback({
  selectedReasons,
  otherReason,
  hasUsedSimilar,
  similarAppName,
  feedbackComment,
  isSkip,
  userId,
}: FeedbackProps): Promise<{ success: boolean; message: string }> {
  try {
    await connectToDB();

    const feedback = new FeedbackModel({
      selectedReasons,
      otherReason,
      hasUsedSimilar,
      similarAppName,
      feedbackComment,
      isSkip,
      feedbackDate: new Date(),
      feedbackBy: userId,
    });

    await feedback.save();

    return { success: true, message: "Feedback submitted successfully" };
  } catch (error: any) {
    console.error("Error submitting feedback:", error);
    return { success: false, message: error.message };
  }
}

interface ParamsSendFlexMessage {
  userId: string;
  flexContent: string;
}

export async function sendFlexMessageThruOA({
  userId,
  flexContent,
}: ParamsSendFlexMessage): Promise<{ success: boolean; message: string }> {
  const url = "https://api.line.me/v2/bot/message/push";
  const channelAccessToken = process.env.MESSAGING_LINE_CHANNEL_AT;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${channelAccessToken}`,
  };

  if (typeof flexContent === "string") {
    try {
      flexContent = JSON.parse(flexContent);
    } catch (error) {
      console.error("Error parsing flexContent:", error);
      return {
        success: false,
        message: "Something went wrong, Please try again later.",
      };
    }
  }

  const data = {
    to: userId,
    messages: [
      {
        type: "flex",
        altText: "This is a Flex Message",
        contents: flexContent,
      },
    ],
  };

  const JSONData = JSON.stringify(data);

  try {
    const response = await axios.post(url, JSONData, { headers });
    // console.log('Message sent:', response.data);
    return {
      success: true,
      message: "Card has been shared successfully, Please check your LINE.",
    };
  } catch (error: any) {
    console.error(
      "Error sharing Card Line:",
      error.response ? error.response.data : error.message
    );
    return {
      success: false,
      message: "Failed to share card to LINE, Please try again later.",
    };
  }
}

export async function fetchDashboardData({ userId }: { userId: string }) {
  try {
    await connectToDB();

    const cardDashboard = await MemberModel.findOne({ user: userId }).select(
      "cards totalViews followers"
    );

    if (!cardDashboard) {
      throw new Error("Member not found");
    }

    const quantityOfCard = cardDashboard.cards.length;
    const profileViews = cardDashboard.totalViews;
    const totalFollowers = cardDashboard.followers.length;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const cardsLastWeek = await Card.find({
      creator: userId,
      createdAt: { $gte: sevenDaysAgo },
    }).countDocuments();

    const profileViewsLastWeek = await MemberModel.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(cardDashboard._id) } },
      { $unwind: "$viewDetails" },
      { $match: { "viewDetails.viewedAt": { $gte: sevenDaysAgo } } },
      { $group: { _id: null, totalViews: { $sum: 1 } } },
    ]);

    const totalFollowersLastWeek = await MemberModel.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(cardDashboard._id) } },
      { $unwind: "$followers" },
      { $match: { "followers.followedAt": { $gte: sevenDaysAgo } } },
      { $group: { _id: null, totalFollowers: { $sum: 1 } } },
    ]);

    return {
      memberCardQuantity: quantityOfCard,
      profileViews: profileViews,
      followersIncrease: totalFollowers,
      cardsLastWeek: cardsLastWeek,
      profileViewsLastWeek: profileViewsLastWeek[0]?.totalViews || 0,
      totalFollowersLastWeek: totalFollowersLastWeek[0]?.totalFollowers || 0,
    };
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    throw error;
  }
}

// cannot run on server side
export async function sendFlexMessageLiff(flexContent: string) {
  try {
    const liffId = process.env.LIFF_LINE_CLIENT_ID;

    await liff.init({ liffId: liffId! });
    if (liff.isInClient()) {
      await liff.shareTargetPicker([
        {
          type: "flex",
          altText: "This is a Flex Message",
          contents: JSON.parse(flexContent),
        },
      ]);
      return {
        success: true,
        message: "Card has been shared successfully, Please check your LINE.",
      };
    } else {
      return {
        success: false,
        message: "Failed to share card to LINE, Please open in Line app.",
      };
    }
  } catch (error: any) {
    console.log("Error sharing Card Line:", error.message);
    return {
      success: false,
      message: "Failed to share card to LINE, Please try again later.",
    };
  }
}

import { MongoClient } from "mongodb";
import { Friend, User } from "@/types";

// get all possible member // need to remove this
export async function fetchAllMembers() {
  try {
    const uri = process.env.MONGODB_URL || "your-mongodb-connection-string";

    const client = new MongoClient(uri);

    // db name
    const db = client.db("test");

    //collection
    const collection = db.collection("members");

    // fetch all members
    const members = await collection.find({}).toArray();

    await client.close();

    return members;
  } catch (error: any) {
    throw new Error(`Failed to fetch member: ${error.message}`);
  }
}

// fetch all user(public and private)
export async function fetchAllUser(authenticatedUserId: string) {
  try {
    await connectToDB();

    // fetch all member no matter public and private
    const members = await MemberModel.find({}).select("user accountType");

    // console.log("members" + members);

    const userIds = members.map((member) => member.user);

    // console.log("userIds" + userIds);

    // filter out the current userId
    const users = await UserModel.find({
      _id: { $in: userIds, $ne: authenticatedUserId },
    });

    const usersWithIdAsString = await Promise.all(
      users.map(async (user) => {
        const member = members.find(
          (member) => member.user.toString() === user._id.toString()
        );

        const friendStatus = await FriendModel.findOne({
          $or: [
            { userA: authenticatedUserId, userB: user._id },
            { userA: user._id, userB: authenticatedUserId },
          ],
        });

        // 1 is friend, 0 is not
        const status = friendStatus ? "1" : "0";

        return {
          ...user.toObject(),
          _id: user._id.toString(),
          friendStatus: status,
          accountType: member?.accountType || "public",
        };
      })
    );

    return usersWithIdAsString;
  } catch (error: any) {
    throw new Error(`Failed to fetch users: ${error.message}`);
  }
}

// send friend request
export async function sendFriendRequest(senderId: string, receiverId: string) {
  try {
    await connectToDB();

    const sender = await UserModel.findById(senderId);

    const receiver = await UserModel.findById(receiverId);

    // console.log("sender:" + sender + "receiver:" + receiver);

    if (!sender) {
      throw new Error("Sender not found");
    }

    if (!receiver) {
      throw new Error("Receiver not found");
    }

    const friendRequest = new FriendRequestModel({
      sender: senderId,
      receiver: receiverId,
      status: 1,
    });

    // console.log("request:" + friendRequest);
    await friendRequest.save();

    return { success: true, message: "Friend request sent successfully" };
  } catch (error: any) {
    console.error("Error sending friend request:", error);
    return { success: false, message: error.message };
  }
}

// check friend request status
export async function getFriendRequestStatus(
  senderId: string,
  receiverId: string
) {
  try {
    await connectToDB();

    const friendRequest = await FriendRequestModel.findOne({
      sender: senderId,
      receiver: receiverId,
    });

    // console.log("friend request:" + friendRequest);

    if (friendRequest) {
      return {
        success: true,
        message: "Friend request found",
        status: friendRequest.status,
      };
    } else {
      return { success: false, message: "No friend request found" };
    }
  } catch (error: any) {
    console.error("Error checking friend request status:", error);
    return { success: false, message: error.message };
  }
}

// get current user all friend request
export async function getCurrentUserAllFriendRequest(authenticatedId: string) {
  try {
    await connectToDB();

    const allFriendRequests = await FriendRequestModel.find({
      receiver: authenticatedId,
    }).lean();

    const friendRequestWithSenderName = await Promise.all(
      allFriendRequests.map(async (friendRequest) => {
        const senderId = friendRequest.sender.toString();
        const senderUser: User | null = await UserModel.findById(
          senderId
        ).lean();
        const senderName = senderUser ? senderUser.name : "Unknown";

        return {
          ...friendRequest,
          senderName,
        };
      })
    );

    // console.log(
    //   "friend request:" + JSON.stringify(friendRequestWithSenderName, null, 2)
    // );

    if (friendRequestWithSenderName.length > 0) {
      return {
        success: true,
        friendRequests: friendRequestWithSenderName,
        length: friendRequestWithSenderName,
      };
    } else {
      return { success: false, message: "No Friend Requests found", length: 0 };
    }
  } catch (error: any) {
    console.error(
      "Error checking current user's friend request status:",
      error
    );
    return { success: false, message: error.message };
  }
}

// get each user's friend
export async function getUserFriend(authenticatedId: string) {
  try {
    await connectToDB();

    const userFriends: Friend[] = await FriendModel.find({
      $or: [{ userA: authenticatedId }, { userB: authenticatedId }],
    }).lean();

    const friendsWithUserData = await Promise.all(
      userFriends.map(async (friend) => {
        const friendUserId =
          friend.userA.toString() === authenticatedId
            ? friend.userB.toString()
            : friend.userA.toString();

        const friendUser = await UserModel.findById(friendUserId).lean();

        return {
          ...friend,
          friendUser: friendUser as User,
        };
      })
    );

    // console.log("data:" + JSON.stringify(friendsWithUserData, null, 2));

    if (friendsWithUserData.length > 0) {
      return {
        success: true,
        message: "Friend found",
        friends: friendsWithUserData,
      };
    } else {
      return { success: false, message: "No friend found" };
    }
  } catch (error: any) {
    console.error("Error checking friend request status:", error);
    return { success: false, message: error.message };
  }
}

// accept friend request handler & let the user follow each other
export async function acceptFriendRequest(
  authenticatedId: string,
  otherUserId: string,
  friendRequestId: string
) {
  try {
    await connectToDB();

    console.log(authenticatedId);
    console.log(friendRequestId);

    const updatedFriendRequest = await FriendRequestModel.findByIdAndUpdate(
      friendRequestId,
      { status: 2 },
      { new: true }
    );

    if (updatedFriendRequest) {
      console.log(updatedFriendRequest);

      const userA = updatedFriendRequest.sender;
      const userB = updatedFriendRequest.receiver;

      // insert into friendmodel
      const newFriend = await FriendModel.create({
        userA: userA,
        userB: userB,
      });

      console.log("New Friend Entry: ", newFriend);

      // authenticated user follows the other user
      const followResultOne = await MemberModel.findOneAndUpdate(
        { user: authenticatedId },
        { $addToSet: { following: otherUserId } }
      );

      // authenticated user is followd by the other user
      const followResultThree = await MemberModel.findOneAndUpdate(
        { user: authenticatedId },
        {
          $addToSet: {
            followers: { followersId: otherUserId, followedAt: new Date() },
          },
        }
      );

      // other user follow the authenticated user
      const followResultTwo = await MemberModel.findOneAndUpdate(
        { user: otherUserId },
        { $addToSet: { following: authenticatedId } }
      );

      // other user is follwoed by authenticated user
      const followResultFour = await MemberModel.findOneAndUpdate(
        { user: otherUserId },
        {
          $addToSet: {
            followers: { followersId: authenticatedId, followedAt: new Date() },
          },
        }
      );

      return {
        success: true,
        message: "Friend request accepted and added to friends list",
        friendRequest: updatedFriendRequest,
        newFriend: newFriend,
      };
    } else {
      return { success: false, message: "Friend request not found" };
    }
  } catch (error: any) {
    console.error("Error accepting friend request:", error);
    return { success: false, message: error.message };
  }
}

// decline friend request handler
export async function declineFriendRequest(friendRequestId: string) {
  try {
    await connectToDB();

    // console.log(friendRequestId);
    const updatedFriendRequest = await FriendRequestModel.findByIdAndUpdate(
      friendRequestId,
      { status: 0 },
      { new: true }
    );

    if (updatedFriendRequest) {
      console.log(updatedFriendRequest);

      return {
        success: true,
        message: "Decline Friend Request succesfully!",
        friendRequest: updatedFriendRequest,
      };
    } else {
      return { success: false, message: "Friend request not found" };
    }
  } catch (error: any) {
    console.error("Error decline friend request:", error);
    return { success: false, message: error.message };
  }
}

// unfriend handler
export async function unfriendFriend(
  authenticatedId: string,
  friendRequestId: string
) {
  try {
    await connectToDB();

    // console.log("authenticatedId:" + authenticatedId);
    // console.log("friendRequestId:" + friendRequestId);

    const friendRelation = await FriendModel.findOneAndDelete({
      $or: [
        { userA: authenticatedId, userB: friendRequestId },
        { userA: friendRequestId, userB: authenticatedId },
      ],
    });

    console.log(friendRelation);

    if (!friendRelation) {
      return { success: false, message: "Friend relation not found" };
    }

    return { success: true, message: "Successfully unfriended" };
  } catch (error: any) {
    console.error("Error when unfriending:", error);
    return { success: false, message: error.message };
  }
}

// unfollow existing friend
export async function unfollowFriend(
  authenticatedId: string,
  friendRequestId: string
) {
  try {
    await connectToDB();

    // authenticated user remove the follwing
    const removeFollowingFromCurrentUser = await MemberModel.findOneAndUpdate(
      { user: authenticatedId },
      { $pull: { following: friendRequestId } }
    );

    const removeFollowerFromTargetUser = await MemberModel.findOneAndUpdate(
      { user: friendRequestId },
      { $pull: { followers: { followersId: authenticatedId } } }
    );

    return {
      success: true,
      message: "Successfully unfollowed the user",
    };
  } catch (error: any) {
    console.error("Error when unfollowing:", error);
    return { success: false, message: error.message };
  }
}

// unfollow before but still friend, want to follow back
export async function followFriend(authenticatedId: string, friendId: string) {
  try {
    await connectToDB();

    const followFromAuthUser = await MemberModel.findOneAndUpdate(
      { user: authenticatedId },
      { $addToSet: { following: friendId } }
    );

    // console.log("followFromAuthUser" + followFromAuthUser);

    const followingFromOtherUser = await MemberModel.findOneAndUpdate(
      { user: friendId },
      {
        $addToSet: {
          followers: { followersId: authenticatedId, followedAt: new Date() },
        },
      }
    );

    // console.log("followingFromOtherUser" + followingFromOtherUser);

    return { success: true, message: "Successfully followed" };
  } catch (error: any) {
    console.error("Error following user:", error);
    return { success: false, message: error.message };
  }
}

// get follow status of each friend
export async function getFollowStatus(
  authenticatedId: string,
  friendId: string
) {
  try {
    await connectToDB();

    const member = await MemberModel.findOne({ user: authenticatedId });
    // console.log("member" + member);
    const isFollowing = member.following.includes(friendId);
    console.log("isFollwing" + isFollowing);

    return { success: true, isFollowing };
  } catch (error: any) {
    console.error("Error fetching follow status:", error);
    return { success: false, message: error.message, isFollowing: false };
  }
}

// follow private acc
export async function followPrivateAcc(
  authenticatedId: string,
  followedId: string
) {
  try {
    await connectToDB();

    const privateAcc = await MemberModel.findOne({ user: followedId }).select(
      "accountType"
    );

    if (!privateAcc || privateAcc.accountType !== "private") {
      return {
        success: false,
        message: "Cannot follow. The account is not private.",
      };
    }
    // go into follow request table

    // const updateCurrentUserFollowing = await MemberModel.findOneAndUpdate(
    //   { user: authenticatedId },
    //   { $addToSet: { following: followedId } }
    // );

    // if (!updateCurrentUserFollowing) {
    //   return {
    //     success: false,
    //     message: "Failed to update the following list.",
    //   };
    // }

    // console.log("updateCurrentUserFollowing" + updateCurrentUserFollowing);

    // const updatePrivateUserFollower = await MemberModel.findOneAndUpdate(
    //   { user: followedId },
    //   {
    //     $addToSet: {
    //       followers: { followersId: authenticatedId, followedAt: new Date() },
    //     },
    //   }
    // );

    // if (!updatePrivateUserFollower) {
    //   return {
    //     success: false,
    //     message: "Failed to update the private user's followers list.",
    //   };
    // }

    // console.log("updatePrivateUserFollower" + updatePrivateUserFollower);

    return {
      success: true,
      message: "Successfully followed the private account.",
    };
  } catch (error: any) {
    console.error("Error following private account:", error);
    return { success: false, message: "Error following private account." };
  }
}

// get follower for current acc
export async function getAllFollowers(userId: string) {
  try {
    await connectToDB();

    const member = await MemberModel.findOne({ user: userId }).populate({
      path: "followers.followersId",
      select: "name image _id",
    });

    if (!member) {
      return { success: false, message: "User not found", followers: [] };
    }

    return {
      success: true,
      followers: member.followers.map((follower: any) => ({
        _id: follower.followersId._id,
        name: follower.followersId.name,
        image: follower.followersId.image,
        followedAt: follower.followedAt,
      })),
    };
  } catch (error: any) {
    console.error("Error fetching followers:", error);
    return { success: false, message: error.message, followers: [] };
  }
}

// get following for current acc
export async function getAllFollowing(userId: string) {
  try {
    await connectToDB();

    const member = await MemberModel.findOne({ user: userId }).populate({
      path: "following",
      select: "name image _id",
    });

    if (!member) {
      return { success: false, message: "User not found", following: [] };
    }

    return {
      success: true,
      following: member.following.map((followingUser: any) => ({
        _id: followingUser._id,
        name: followingUser.name,
        image: followingUser.image,
      })),
    };
  } catch (error: any) {
    console.error("Error fetching following users:", error);
    return { success: false, message: error.message, following: [] };
  }
}

// follow a public acc / no need approve from the user
export async function sendFollowRequestPublic(
  authenticatedId: string,
  targetUserId: string
) {
  try {
    await connectToDB();

    // target public acc
    const targetMember = await MemberModel.findOne({
      user: targetUserId,
    }).select("accountType");

    if (!targetMember) {
      return { success: false, message: "Target user not found" };
    }

    // check public
    if (targetMember.accountType !== "public") {
      return {
        success: false,
        message: "Cannot follow. The account is not public.",
      };
    }

    // Update the authenticated user's following list
    const updateFollowing = await MemberModel.findOneAndUpdate(
      { user: authenticatedId },
      { $addToSet: { following: targetUserId } },
      { new: true }
    );

    // Update the target user's followers list
    const updateFollowers = await MemberModel.findOneAndUpdate(
      { user: targetUserId },
      {
        $addToSet: {
          followers: { followersId: authenticatedId, followedAt: new Date() },
        },
      },
      { new: true }
    );

    if (updateFollowing && updateFollowers) {
      return {
        success: true,
        message: "Successfully followed the public account.",
      };
    } else {
      return {
        success: false,
        message: "Failed to update follow relationship.",
      };
    }
  } catch (error: any) {
    console.error("Error following public account:", error);
    return { success: false, message: "Error following public account." };
  }
}

// follow a private acc/ need approval from the user
export async function sendFollowRequestPrivate(
  authenticatedId: string,
  targetUserId: string
) {
  try {
    await connectToDB();

    const targetMember = await MemberModel.findOne({
      user: targetUserId,
    }).select("accountType");

    if (!targetMember) {
      return { success: false, message: "Target user not found" };
    }

    if (targetMember.accountType !== "private") {
      return {
        success: false,
        message: "Cannot send follow request. The account is not private.",
      };
    }

    // Check if a follow request already exists
    const existingRequest = await FollowRequestModel.findOne({
      sender: authenticatedId,
      receiver: targetUserId,
    });

    if (existingRequest) {
      return {
        success: false,
        message: "Follow request already sent.",
      };
    }

    // Create a new follow request
    const newFollowRequest = await FollowRequestModel.create({
      sender: authenticatedId,
      receiver: targetUserId,
      status: 0,
    });

    if (newFollowRequest) {
      return {
        success: true,
        message: "Follow request sent successfully.",
      };
    } else {
      return {
        success: false,
        message: "Failed to send follow request.",
      };
    }
  } catch (error: any) {
    console.error("Error sending follow request:", error);
    return { success: false, message: "Error sending follow request." };
  }
}
