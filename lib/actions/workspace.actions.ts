"use server";

import CardMongodb from "../models/card";
import Member from "../models/member";
import Image from "../models/image";
import { connectToDB } from "../mongodb";
import { Card } from "@/types";
import { v4 as uuidv4 } from 'uuid';
import ComponentModel from "../models/component";


export async function fetchCardsByAccountId(accountId: string) {
  try {
    await connectToDB();

    const Cards = await Member.find({ user: accountId }).populate('cards').exec();

    return Cards;
  } catch (error: any) {
    throw new Error(`Error getting Cards: ${error.message}`);
  }
}

export async function fetchCardDetails(cardId: string) {
  try {
    await connectToDB();

    const card = await CardMongodb.findById(cardId);
    if (!card) {
      throw new Error('Card not found');
    }

    const creator = await Member.findOne({ user: card.creator }).select('accountname image');
    const creatorImage = await Image.findOne({ _id: creator?.image }).select('binaryCode');
    const creatorData = {
      accountname: creator ? creator.accountname : "Unknown",
      image: creator && creatorImage ? creatorImage.binaryCode : undefined
    };

    const lineComponents = await CardMongodb.findById(cardId).select('lineFormatComponent');

    const likesDetails = await Promise.all(card.likes.map(async (likeId: any) => {
      const likeUser = await Member.findOne({ user: likeId }).select('accountname image');
      if (likeUser && likeUser.image) {
        const imageDoc = await Image.findById(likeUser.image).select('binaryCode');
        return {
          accountname: likeUser.accountname,
          binarycode: imageDoc ? imageDoc.binaryCode : undefined
        };
      }
      return {
        accountname: likeUser ? likeUser.accountname : "Unknown",
        binarycode: undefined
      };
    }));

    const flexFormatHTML = await CardMongodb.findById(cardId).select('flexFormatHtml');
    const followers = await Promise.all(card.followers.map((id: any) => Member.findOne({ user: id }).select('accountname')));
    const lineFormatComponent = await ComponentModel.findById(lineComponents.lineFormatComponent).select('content');
    const flexFormatHTMLContent = await ComponentModel.findById(flexFormatHTML.flexFormatHtml).select('content');

    return {
      cardID: card._id.toString(),
      title: card.title,
      status: card.status,
      description: card.description,
      creator: creatorData,
      creatorID: card.creator,
      likes: likesDetails,
      followers: followers.map(follower => ({ accountname: follower.accountname })),
      components: card.components,
      lineComponents: {
        content: lineFormatComponent ? lineFormatComponent.content : undefined,
      },
      flexHtml: {
        content: flexFormatHTMLContent ? flexFormatHTMLContent.content : undefined,
      },
      updatedAt: card.updatedAt,
    };
  } catch (error) {
    console.error("Error fetching card details:", error);
    throw error;
  }
}

export async function fetchSuggestedCards(currentCardId: string) {
  try {
    await connectToDB();

    const topLikedCards = await CardMongodb.find({ _id: { $ne: currentCardId } })
      .sort({ likes: -1 })
      .limit(5)
      .lean()
      .exec();

    const additionalCards = await CardMongodb.find({ _id: { $ne: currentCardId } })
      .skip(5)
      .lean()
      .exec();

    const suggestedCards = [...topLikedCards, ...additionalCards];

    const processedCards = await Promise.all(suggestedCards.map(async (card: any) => {
      const creator = await Member.findOne({ user: card.creator }).select('accountname image');
      const creatorImage = await Image.findOne({ _id: creator?.image }).select('binaryCode');
      const creatorData = {
        accountname: creator ? creator.accountname : "Unknown",
        image: creator && creatorImage ? creatorImage.binaryCode : undefined
      };

      const lineComponents = await CardMongodb.findById(card._id).select('lineFormatComponent');

      const likesDetails = await Promise.all(card.likes.map(async (likeId: any) => {
        const likeUser = await Member.findOne({ user: likeId }).select('accountname image');
        if (likeUser && likeUser.image) {
          const imageDoc = await Image.findById(likeUser.image).select('binaryCode');
          return {
            accountname: likeUser.accountname,
            binarycode: imageDoc ? imageDoc.binaryCode : undefined
          };
        }
        return {
          accountname: likeUser ? likeUser.accountname : "Unknown",
          binarycode: undefined
        };
      }));

      const flexFormatHTML = await CardMongodb.findById(card._id).select('flexFormatHtml');

      const followers = await Promise.all(card.followers.map((id: any) => Member.findOne({ user: id }).select('accountname')));

      const lineFormatComponent = await ComponentModel.findById(lineComponents.lineFormatComponent).select('content');
      const flexFormatHTMLContent = await ComponentModel.findById(flexFormatHTML.flexFormatHtml).select('content');

      return {
        cardId: card._id.toString(),
        title: card.title,
        description: card.description,
        creator: creatorData,
        creatorID: card.creator,
        likes: likesDetails,
        followers: followers.map(follower => ({ accountname: follower.accountname })),
        lineComponents: {
          content: lineFormatComponent ? lineFormatComponent.content : undefined,
        },
        flexHtml: {
          content: flexFormatHTMLContent ? flexFormatHTMLContent.content : undefined,
        }
      };
    }));

    return processedCards;
  } catch (error) {
    console.error("Error fetching suggested cards:", error);
    throw error;
  }
}

export async function fetchComponent(componentId: string) {
  try {
    await connectToDB();

    const component = await ComponentModel.findOne({ _id: componentId });

    return component;
  } catch (error: any) {
    throw new Error(`Error getting component: ${error.message}`);
  }
}

function generateCustomID() {
  return uuidv4();
}

export async function upsertCardContent(authaccountId: string, cardDetails: Card, cardContent: string, lineFormatCard: string, flexFormatHtml: string, cardId: string) {
  if (!authaccountId) return;

  try {
    await connectToDB();
  
    console.log("cardDetails from edit: ", cardDetails); 

    const existingCard = await CardMongodb.findById(cardId);

    if (!existingCard) {
      const cardComponent = {
        componentID: generateCustomID(),
        componentType: "flexCard",
        content: cardContent,
      };

      const newCardComponent = new ComponentModel(cardComponent);
      await newCardComponent.save();

      const lineFormatCardComponent = {
        componentID: generateCustomID(),
        componentType: "line",
        content: lineFormatCard,
      };

      const newLineFormatCard = new ComponentModel(lineFormatCardComponent);
      await newLineFormatCard.save();

      const newFlexHtml = {
        componentID: generateCustomID(),
        componentType: "html",
        content: flexFormatHtml,
      };

      const newFlexHtmlComponent = new ComponentModel(newFlexHtml);
      await newFlexHtmlComponent.save();

      const newCardContent = {
        cardID: cardId,
        creator: authaccountId,
        title: cardDetails.title,
        status: cardDetails.status,
        description: cardDetails.description,
        components: newCardComponent._id,
        lineFormatComponent: newLineFormatCard._id,
        flexFormatHtml: newFlexHtmlComponent._id,
      };

      const newCard = new CardMongodb(newCardContent);
      await newCard.save();

      const currentMember = await Member.findOne({ user: authaccountId });

      if (currentMember) {
        currentMember.cards.push(newCard);
        await currentMember.save();
      }

      return newCard;
    }
    else {
      const title = cardDetails.title;
      const description = cardDetails.description;

      const componentID = existingCard.components;
      const lineFormatComponentID = existingCard.lineFormatComponent;
      const flexFormatHtmlID = existingCard.flexFormatHtml;

      const existingComponent = await ComponentModel.findOne({ _id: componentID });
      if (!existingComponent) {
        throw new Error("Component not found.");
      }

      existingComponent.content = cardContent;
      await existingComponent.save();

      const existingLineFormatComponent = await ComponentModel.findOne({ _id: lineFormatComponentID });
      if (!existingLineFormatComponent) {
        throw new Error("Line format component not found.");
      }

      existingLineFormatComponent.content = lineFormatCard;
      await existingLineFormatComponent.save();

      const existingFlexFormatHTML = await ComponentModel.findOne({ _id: flexFormatHtmlID });
      if (!existingFlexFormatHTML) {
        throw new Error("Flex format Html not found.");
      }

      existingFlexFormatHTML.content = flexFormatHtml;
      await existingFlexFormatHTML.save();

      const response = await CardMongodb.updateOne(
        { cardID: existingCard.cardID },
        {
          $set: { title: title, description: description }
        });

      return response;
    }

  } catch (error: any) {
    throw new Error(`Error upserting card content: ${error.message}`);
  }
}

export async function checkDuplicateCard(
  authaccountId: string,
  cardId: string
): Promise<{ success: boolean; message?: string }> {
  try {
    await connectToDB();

    const authenticatedUserId = await Member.findOne({ user: authaccountId });

    if (!authenticatedUserId) {
      return { success: false, message: "You need to login before save the card" };
    }

    const existingCard = await CardMongodb.findOne({ cardID: cardId });

    if (!existingCard) {
      return { success: true };
    } else {
      return { success: false, message: "Opps, Card already exists, Please try again later." };
    }
  }
  catch {
    return { success: false };
  }
}

export async function updateCardTitle(authaccountId: string, cardId: string, newTitle: string) {
  try {
    await connectToDB();

    const existingCard = await CardMongodb.findById(cardId);
    if (!existingCard) {
      throw new Error("Card not found.");
    }

    if (authaccountId !== existingCard.creator) {
      return new Error("Unauthorized to update card title.");
    }

    const updatedCard = await CardMongodb.updateOne(
      { cardID: existingCard.cardID },
      {
        $set: { title: newTitle }
      });

    return updatedCard;
  } catch (error: any) {
    throw new Error(`Error updating title of card: ${error.message}`);
  }
}