import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";

test("renderiza titulo principal", () => {
  render(<App />);
  const titulo = screen.getByRole("heading", { name: /controle de faturamento/i });
  expect(titulo).toBeInTheDocument();
});
