import type { MouseEvent } from "react";
import { Box, Flex, Link, Text } from "theme-ui";

const WHC_HOSTED_URL =
  "https://whc.ca/hosted-in-canada/?aff=3153&gbid=2en";

function Footer() {
  return (
    <Flex
      as="footer"
      bg="muted"
      sx={{
        flexDirection: "column",
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        pt: 3,
        px: 2,
        pb: "calc(12px + env(safe-area-inset-bottom))",
      }}
    >
      <Text sx={{ textAlign: "center", fontSize: 1 }}>
        <Link
          href="https://github.com/Anqui3tas"
          target="_blank"
          rel="noopener noreferrer"
          variant="footer"
        >
          Always Open Source
        </Link>
        {" - © LanteaCorp a Lantea LLC company ’26"}
      </Text>
      <Box>
        <Link
          href={WHC_HOSTED_URL}
          variant="footer"
          onClick={(e: MouseEvent<HTMLAnchorElement>) => {
            e.preventDefault();
            window.open(
              WHC_HOSTED_URL,
              "popupWindow",
              "width=450,height=695,status=no,scrollbars=no,menubar=no"
            );
          }}
        >
          <img
            src="https://s.whc.ca/badges/hosted-in-canada-badge.svg"
            width={80}
            alt="Canadian Badge"
          />
        </Link>
      </Box>
    </Flex>
  );
}

export default Footer;
