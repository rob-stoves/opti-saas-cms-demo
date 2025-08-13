import { defineAction } from "astro:actions";
import { z } from "astro:schema";

export async function submitFormData(method: string, submitUrl: string, payload?: any) {
    const url = new URL(submitUrl);
    const headers: any = {
        "Content-Type": "application/json",
    };
    const formFields = Object.fromEntries(payload.entries());

    try {
        const response = await fetch(url.href, {
            method: method,
            headers,
            body: JSON.stringify(formFields),
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

        handler: async (formSubmission) => {
            const webhookUrl = formSubmission.get('formSubmitUrl') as string;

            if (!webhookUrl) {
                throw new Error('No submit URL provided');
            }

            formSubmission.delete('formSubmitUrl');

            const responseData = await submitFormData("POST", webhookUrl, formSubmission);

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
