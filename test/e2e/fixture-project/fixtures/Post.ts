import { gql } from "@urql/core";

export const PostFields = gql`
    fragment postFields on Post {
        title
    }
`

export const Post = (post: any) => {
    return post.title
}
