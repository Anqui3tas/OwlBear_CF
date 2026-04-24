import { useState, useEffect } from "react";
import { Flex, Button, Image, Text } from "theme-ui";

import Footer from "../components/Footer";

import StartModal from "../modals/StartModal";
import JoinModal from "../modals/JoinModal";
import GettingStartedModal from "../modals/GettingStartedModal";

import HelpIcon from "../icons/HelpIcon";

import { useAuth } from "../contexts/AuthContext";

import owlington from "../images/Owlington.png";

function Home() {
  const [isStartModalOpen, setIsStartModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isGettingStartedModalOpen, setIsGettingStartedModalOpen] =
    useState(false);

  // Reset password on visiting home
  const { setPassword } = useAuth();
  useEffect(() => {
    setPassword("");
  }, [setPassword]);

  return (
    <Flex
      sx={{
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: "100%",
        alignItems: "center",
      }}
    >
      <Flex
        sx={{
          flexDirection: "column",
          justifyContent: "center",
          maxWidth: "300px",
          flexGrow: 1,
        }}
        mb={2}
      >
        <Text variant="display" as="h1" sx={{ textAlign: "center" }}>
          Rock Gobblers
        </Text>
        <Image src={owlington} m={2} />
        <Button
          variant="secondary"
          m={2}
          onClick={() => setIsGettingStartedModalOpen(true)}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Getting Started <HelpIcon />
        </Button>
        <Button m={2} onClick={() => setIsStartModalOpen(true)}>
          Start Game
        </Button>
        <Button m={2} onClick={() => setIsJoinModalOpen(true)}>
          Join Game
        </Button>
        <JoinModal
          isOpen={isJoinModalOpen}
          onRequestClose={() => setIsJoinModalOpen(false)}
        />
        <StartModal
          isOpen={isStartModalOpen}
          onRequestClose={() => setIsStartModalOpen(false)}
        />
        <GettingStartedModal
          isOpen={isGettingStartedModalOpen}
          onRequestClose={() => setIsGettingStartedModalOpen(false)}
        />
      </Flex>
      <Footer />
    </Flex>
  );
}

export default Home;
