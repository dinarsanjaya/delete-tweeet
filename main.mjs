import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const ua = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
const language_code = 'en';

const config = {
    client_tid: "",
    client_uuid: "",
    random_resource: "uYU5M2i12UhDvDTzN6hZPg",
    username: ""
};

let tweets_to_delete = [];
let stop_signal = undefined;

const delete_options = {
    from_archive: false,
    unretweet: true,
    do_not_remove_pinned_tweet: true,
    delete_message_with_url_only: false,
    delete_specific_ids_only: [""],
    match_any_keywords: [""],
    tweets_to_ignore: [
        "00000000000000",
        "111111111111111",
        "222222222222"
    ],
    old_tweets: false,
    after_date: new Date('1900-01-01'),
    before_date: new Date('2100-01-01')
};

function buildAcceptLanguageString() {
    return "en-US,en;q=0.9";
}

function getCookie(name) {
    switch(name) {
        case 'ct0': return process.env.CSRF_TOKEN;
        case 'twid': return `u=${process.env.USER_ID}`;
        case 'auth_token': return process.env.AUTH_TOKEN;
        default: return '';
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetch_tweets(cursor, retry = 0) {
    let count = "20";
    let final_cursor = cursor ? `%22cursor%22%3A%22${cursor}%22%2C` : "";
    let resource = delete_options.old_tweets ? config.random_resource_old_tweets : config.random_resource;
    let endpoint = delete_options.old_tweets ? "UserTweets" : "UserTweetsAndReplies";
    
    const base_url = `https://x.com/i/api/graphql/${resource}/${endpoint}`;
    const variable = `?variables=%7B%22userId%22%3A%22${process.env.USER_ID}%22%2C%22count%22%3A${count}%2C${final_cursor}%22includePromotedContent%22%3Atrue%2C%22withCommunity%22%3Atrue%2C%22withVoice%22%3Atrue%2C%22withV2Timeline%22%3Atrue%7D`;
    const feature = `&features=%7B%22rweb_lists_timeline_redesign_enabled%22%3Atrue%2C%22responsive_web_graphql_exclude_directive_enabled%22%3Atrue%2C%22verified_phone_label_enabled%22%3Afalse%2C%22creator_subscriptions_tweet_preview_api_enabled%22%3Atrue%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22tweetypie_unmention_optimization_enabled%22%3Atrue%2C%22responsive_web_edit_tweet_api_enabled%22%3Atrue%2C%22graphql_is_translatable_rweb_tweet_is_translatable_enabled%22%3Atrue%2C%22view_counts_everywhere_api_enabled%22%3Atrue%2C%22longform_notetweets_consumption_enabled%22%3Atrue%2C%22responsive_web_twitter_article_tweet_consumption_enabled%22%3Afalse%2C%22tweet_awards_web_tipping_enabled%22%3Afalse%2C%22freedom_of_speech_not_reach_fetch_enabled%22%3Atrue%2C%22standardized_nudges_misinfo%22%3Atrue%2C%22tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled%22%3Atrue%2C%22longform_notetweets_rich_text_read_enabled%22%3Atrue%2C%22longform_notetweets_inline_media_enabled%22%3Atrue%2C%22responsive_web_media_download_video_enabled%22%3Afalse%2C%22responsive_web_enhance_cards_enabled%22%3Afalse%7D`;
    
    const response = await fetch(`${base_url}${variable}${feature}`, {
        headers: {
            "accept": "*/*",
            "accept-language": buildAcceptLanguageString(),
            "authorization": `Bearer ${process.env.BEARER_TOKEN}`,
            "content-type": "application/json",
            "sec-ch-ua": ua,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "x-client-transaction-id": config.client_tid,
            "x-client-uuid": config.client_uuid,
            "x-csrf-token": process.env.CSRF_TOKEN,
            "x-twitter-active-user": "yes",
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-client-language": language_code,
            "Cookie": `auth_token=${process.env.AUTH_TOKEN}; ct0=${process.env.CSRF_TOKEN}`
        },
        referrer: `https://x.com/${config.username}/with_replies`,
        method: "GET"
    });

    if (!response.ok) {
        if (response.status === 429) {
            console.log("Rate limit reached. Waiting 1 minute");
            await sleep(60000);
            return fetch_tweets(cursor, retry + 1);
        }
        if (retry === 5) throw new Error("Max retries reached");
        console.log(`Retrying in ${10 * (1 + retry)} seconds`);
        await sleep(10000 * (1 + retry));
        return fetch_tweets(cursor, retry + 1);
    }

    const data = await response.json();
    const entries = data.data.user.result.timeline_v2.timeline.instructions
        .find(item => item.type === "TimelineAddEntries").entries;
    
    return entries;
}

function check_keywords(text) {
    if (delete_options.match_any_keywords.length === 0) return true;
    return delete_options.match_any_keywords.some(word => text.includes(word));
}

function check_date(tweet) {
    if (!tweet.legacy?.created_at) return true;
    const tweet_date = new Date(tweet.legacy.created_at);
    tweet_date.setHours(0, 0, 0, 0);
    if (tweet_date > delete_options.after_date && tweet_date < delete_options.before_date) return true;
    if (tweet_date < delete_options.after_date) stop_signal = true;
    return false;
}

function check_filter(tweet) {
    if (tweet.legacy?.id_str && delete_options.tweets_to_ignore.includes(tweet.legacy.id_str)) return false;
    if (delete_options.delete_message_with_url_only) {
        return tweet.legacy?.entities?.urls?.length > 0 && 
               check_keywords(tweet.legacy.full_text) && 
               check_date(tweet);
    }
    return check_keywords(tweet.legacy.full_text) && check_date(tweet);
}

function check_tweet_owner(obj, uid) {
    if (obj.legacy?.retweeted === true && !delete_options.unretweet) return false;
    return (obj.user_id_str === uid) || (obj.legacy?.user_id_str === uid);
}

function findTweetIds(obj) {
    if (typeof obj !== 'object' || !obj) return;
    if (delete_options.do_not_remove_pinned_tweet && obj.__type === "TimelinePinEntry") return;

    if ((obj.__typename === 'TweetWithVisibilityResults' && obj.tweet) ||
        (obj.__typename === 'Tweet')) {
        const tweet = obj.tweet || obj;
        if (check_tweet_owner(tweet, process.env.USER_ID) && check_filter(tweet)) {
            const id = tweet.id_str || tweet.legacy?.id_str;
            if (id) {
                tweets_to_delete.push(id);
                console.log(`Found tweet: ${tweet.legacy.full_text}`);
            }
        }
    }

    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            findTweetIds(obj[key]);
        }
    }
}

async function delete_tweets(id_list) {
    const delete_tid = "LuSa1GYxAMxWEugf+FtQ/wjCAUkipMAU3jpjkil3ujj7oq6munDCtNaMaFmZ8bcm7CaNvi4GIXj32jp7q32nZU8zc5CyLw";
    let retry = 0;

    for (let i = 0; i < id_list.length; i++) {
        try {
            const response = await fetch("https://x.com/i/api/graphql/VaenaVgh5q5ih7kvyVjgtg/DeleteTweet", {
                headers: {
                    "accept": "*/*",
                    "accept-language": buildAcceptLanguageString(),
                    "authorization": `Bearer ${process.env.BEARER_TOKEN}`,
                    "content-type": "application/json",
                    "sec-ch-ua": ua,
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Windows\"",
                    "x-client-transaction-id": delete_tid,
                    "x-client-uuid": config.client_uuid,
                    "x-csrf-token": process.env.CSRF_TOKEN,
                    "x-twitter-active-user": "yes",
                    "x-twitter-auth-type": "OAuth2Session",
                    "x-twitter-client-language": language_code,
                    "Cookie": `auth_token=${process.env.AUTH_TOKEN}; ct0=${process.env.CSRF_TOKEN}`
                },
                body: JSON.stringify({
                    variables: {
                        tweet_id: id_list[i],
                        dark_request: false
                    },
                    queryId: "VaenaVgh5q5ih7kvyVjgtg"
                }),
                method: "POST"
            });

            if (!response.ok) {
                if (response.status === 429) {
                    console.log("Rate limit reached. Waiting 1 minute");
                    await sleep(60000);
                    i--;
                    continue;
                }
                if (retry === 8) throw new Error("Max retries reached");
                console.log(`Retrying tweet deletion in ${10 * (1 + retry)} seconds`);
                i--;
                retry++;
                await sleep(10000 * retry);
                continue;
            }
            
            retry = 0;
            console.log(`${i + 1}/${id_list.length} tweets deleted`);
            await sleep(100);
        } catch (error) {
            console.error(`Error deleting tweet ${id_list[i]}:`, error);
        }
    }
}

async function main() {
    let next = null;

    if (delete_options.delete_specific_ids_only[0].length > 0) {
        await delete_tweets(delete_options.delete_specific_ids_only);
    } else {
        while (next !== "finished" && !stop_signal) {
            const entries = await fetch_tweets(next);
            for (const item of entries) {
                if (item.entryId.startsWith("profile-conversation") || 
                    item.entryId.startsWith("tweet-")) {
                    findTweetIds(item);
                } else if (item.entryId.startsWith("cursor-bottom") && 
                          entries.length > 2) {
                    next = item.content.value;
                    continue;
                }
                next = "finished";
            }
            
            if (tweets_to_delete.length > 0) {
                await delete_tweets(tweets_to_delete);
                tweets_to_delete = [];
            }
            await sleep(3000);
        }
    }

    console.log("Deletion complete");
}

main().catch(console.error);