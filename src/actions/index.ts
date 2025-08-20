import { defineAction } from "astro:actions";
import { z } from "astro:schema";

const odpBaseUrl = import.meta.env.OPTIMIZELY_DATA_PLATFORM_ENDPOINT;
const odpPrivateKey = import.meta.env.OPTIMIZELY_DATA_PLATFORM_PRIVATE_KEY;

// Construct the ODP profile endpoint from the environment variable.
const ODP_PROFILE_ENDPOINT = odpBaseUrl
    ? `${odpBaseUrl.replace(/\/$/, "")}/v3/profiles`
    : "";

const odpPublicKey = odpPrivateKey ? odpPrivateKey.split('.')[0] : null;

/**
 * Converts FormData to a plain object with lowercase keys.
 * @param formData The FormData object.
 * @returns A plain object with lowercase keys.
 */
function formDataToObjectWithLowercaseKeys(formData: FormData): { [key: string]: FormDataEntryValue } {
    const obj: { [key: string]: FormDataEntryValue } = {};
    for (const [key, value] of formData.entries()) {
        obj[key.toLowerCase()] = value;
    }
    return obj;
}

/**
 * Transforms FormData into the specific JSON structure required by the ODP API.
 * This converts form field names to lowercase and nests them inside an 'attributes' object.
 * @param formData The FormData object from the form submission.
 * @returns An array containing an object with an 'attributes' property.
 */
function transformFormDataForOdp(formData: FormData, vuid?: string | null): any[] {
    const attributes = formDataToObjectWithLowercaseKeys(formData);
    if (vuid) {
        attributes['vuid'] = vuid;
    }
    return [{ attributes }];
}

export async function submitFormData(method: string, submitUrl: string, body?: any) {
    const url = new URL(submitUrl);
    const headers: HeadersInit = {};
    let requestBody: BodyInit | null = null;

    if (ODP_PROFILE_ENDPOINT && submitUrl === ODP_PROFILE_ENDPOINT && odpPublicKey) {
        headers["x-api-key"] = odpPublicKey;
    }

    if (body) {
        if (body instanceof FormData) {
            // For FormData, let fetch set the Content-Type header automatically.
            requestBody = body;
        } else {
            // For other body types, assume JSON.
            headers["Content-Type"] = "application/json";
            requestBody = JSON.stringify(body);
        }
    }

    try {
        const response = await fetch(url.href, {
            method: method,
            headers,
            body: requestBody,
        });
        const data = await response.json();
        return data;
    } catch (error) {
        console.log("error", error);
        throw error;
    }
}

export const server = {
    submitForm: defineAction({
        accept: "form",
        // TODO: server-side validation
        // input: z.object({
        //   email: z
        //     .string({ message: "This field has to be filled." })
        //     .email("This is not a valid email."),
        // }),

        handler: async (formSubmission, { cookies }) => {
            const webhookUrl = formSubmission.get('formSubmitUrl') as string;

            if (!webhookUrl) {
                throw new Error('No submit URL provided');
            }

            formSubmission.delete('formSubmitUrl');

            const normalizedWebhookUrl = webhookUrl.replace(/\/$/, "");
            const normalizedOdpBaseUrl = odpBaseUrl ? odpBaseUrl.replace(/\/$/, "") : "";

            const isOdpSubmission = (ODP_PROFILE_ENDPOINT && normalizedWebhookUrl === ODP_PROFILE_ENDPOINT) || (normalizedOdpBaseUrl && normalizedWebhookUrl === normalizedOdpBaseUrl);

            let payload;
            let finalSubmitUrl = webhookUrl;

            if (isOdpSubmission) {
                if (!ODP_PROFILE_ENDPOINT) {
                    throw new Error("ODP submission intended, but ODP endpoint is not configured.");
                }
                finalSubmitUrl = ODP_PROFILE_ENDPOINT; // Always submit to the full profiles endpoint
                const vuidCookie = cookies.get('vuid')?.value;
                const vuid = vuidCookie ? vuidCookie.split('|')[0] : null;
                payload = transformFormDataForOdp(formSubmission, vuid);
            } else {
                payload = formDataToObjectWithLowercaseKeys(formSubmission);
            }

            const responseData = await submitFormData("POST", finalSubmitUrl, payload);

            if (!responseData) {
                return {
                    formSubmitErrors: null,
                    message: "Oops! Something went wrong. Please try again.",
                };
            }

            if (responseData.error) {
                return {
                    formSubmitErrors: responseData.error,
                    message: "Failed to Register.",
                };
            }

            return {
                message: "Form submitted, thank you.",
                data: responseData,
                formSubmitErrors: null,
            };
        },
    }),
};
