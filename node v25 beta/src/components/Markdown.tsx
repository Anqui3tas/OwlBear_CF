import React from "react";
import {
  Text,
  TextProps,
  Image as UIImage,
  Link as UILink,
  Message,
  Box,
} from "theme-ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function Paragraph(props: TextProps) {
  return <Text as="p" my={2} variant="body2" {...props} />;
}

function Heading({ level, ...props }: { level: number } & TextProps) {
  const fontSize = level === 1 ? 5 : level === 2 ? 3 : 1;
  return (
    <Text
      mt={2}
      mb={1}
      as={`h${level}` as React.ElementType}
      sx={{ fontSize }}
      variant="heading"
      {...props}
    />
  );
}

type MarkdownImageProps = {
  alt?: string;
  src?: string;
};

function Image({ alt, src }: MarkdownImageProps) {
  if (alt === "embed:") {
    return (
      <Box
        as="span"
        sx={{
          display: "block",
          width: "100%",
          height: 0,
          paddingBottom: "56.25%",
          position: "relative",
        }}
        my={2}
      >
        <iframe
          src={src}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            top: 0,
            bottom: 0,
            left: 0,
            border: 0,
          }}
          title="Video"
        />
      </Box>
    );
  }
  if (src?.endsWith(".mp4")) {
    return (
      <video
        style={{ width: "100%", margin: "8px 0" }}
        autoPlay
        muted
        playsInline
        loop
        controls
        src={src}
      />
    );
  }

  return <UIImage mt={2} sx={{ borderRadius: "4px" }} alt={alt} src={src} />;
}

function ListItem(props: TextProps) {
  return <Text as="li" variant="body2" my={1} {...props} />;
}

function Code({ children }: { children?: React.ReactNode }) {
  const value = String(children ?? "");
  let variant = "";
  if (value.startsWith("Warning:")) {
    variant = "warning";
  } else if (value.startsWith("Note:")) {
    variant = "note";
  }
  return (
    <Message
      variant={variant}
      color="hsl(210, 50%, 96%)"
      my={2}
      as="span"
      sx={{ display: "block" }}
    >
      {children}
    </Message>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <Text
      as="table"
      my={4}
      style={{ borderCollapse: "collapse", width: "100%" }}
    >
      {children}
    </Text>
  );
}

function TableHead(props: TextProps) {
  return (
    <Text
      as="thead"
      variant="heading"
      sx={{ textAlign: "left", "& > tr": { borderBottomWidth: "2px" } }}
      {...props}
    />
  );
}

function TableBody(props: TextProps) {
  return (
    <Text
      as="tbody"
      variant="body2"
      sx={{ borderBottomWidth: "1px", "& > tr": { borderBottomWidth: "1px" } }}
      {...props}
    />
  );
}

function TableRow({ children }: { children: React.ReactNode }) {
  return (
    <Text
      as="tr"
      sx={{
        borderBottomStyle: "solid",
        borderBottomColor: "border",
      }}
    >
      {children}
    </Text>
  );
}

function TableCell({ children }: { children: React.ReactNode }) {
  return (
    <Text as="td" p={2}>
      {children}
    </Text>
  );
}

function Link({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return <UILink href={href}>{children}</UILink>;
}

function Markdown({
  source,
  assets,
}: {
  source: string;
  assets: Record<string, string>;
}) {
  const components = {
    p: Paragraph,
    h1: (props: TextProps) => <Heading level={1} {...props} />,
    h2: (props: TextProps) => <Heading level={2} {...props} />,
    h3: (props: TextProps) => <Heading level={3} {...props} />,
    h4: (props: TextProps) => <Heading level={4} {...props} />,
    h5: (props: TextProps) => <Heading level={5} {...props} />,
    h6: (props: TextProps) => <Heading level={6} {...props} />,
    img: ({ src, alt }: MarkdownImageProps) => (
      <Image alt={alt} src={src ? assets[src] || src : undefined} />
    ),
    a: Link,
    li: ListItem,
    code: Code,
    table: Table,
    thead: TableHead,
    tbody: TableBody,
    tr: TableRow,
    td: TableCell,
    th: TableCell,
  };
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as any}>
      {source}
    </ReactMarkdown>
  );
}

Markdown.defaultProps = {
  assets: {},
};

export default Markdown;
