import { graphql, useStaticQuery } from "gatsby";

export type PagesQueryNode = {
  frontmatter: object;
};

export const usePagesQuery = () => {
  const data = useStaticQuery(graphql`
    {
      pages: allJavascriptFrontmatter {
        nodes {
          frontmatter {
            title
          }
        }
      }
    }
  `);

  return data.pages.nodes;
};
